const express = require('express');
const app = express();
const bcrypt = require('bcrypt');
const saltRounds = 10;
const PORT = 9000;
const firebaseAdmin = require("firebase-admin");
const amqp = require('amqplib');
const opossum = require('opossum');

const serviceAccount = require("./maps-89adb-firebase-adminsdk-3ihqg-86a4736f68.json");

firebaseAdmin.initializeApp({
    credential: firebaseAdmin.credential.cert(serviceAccount)
});

const db = firebaseAdmin.firestore();
const usersDb = db.collection('Users');
app.use(express.json());
app.use(express.static('public'));

// Circuit breaker options
const circuitOptions = {
    timeout: 5000, // 5 seconds
    errorThresholdPercentage: 50, // 50% of requests must fail to open circuit
    resetTimeout: 10000 // 10 seconds before trying again
};

// RabbitMQ circuit breaker
const sendToQueue = async (message) => {
    try {
        const connection = await amqp.connect('amqp://localhost');
        const channel = await connection.createChannel();
        const queue = 'user_queue';

        await channel.assertQueue(queue, { durable: true });
        channel.sendToQueue(queue, Buffer.from(message));
        console.log(" [x] Sent %s", message);
        setTimeout(() => {
            channel.close();
            connection.close();
        }, 500);
    } catch (error) {
        throw new Error('Failed to send message to RabbitMQ');
    }
};

// Wrap `sendToQueue` in a circuit breaker
const queueBreaker = new opossum(sendToQueue, circuitOptions);
queueBreaker.fallback(() => console.error('RabbitMQ service unavailable'));

// Firestore transaction with circuit breaker
const registerUserWithTransaction = async (data) => {
    return db.runTransaction(async (transaction) => {
        const existingUserQuery = usersDb.where('userId', '==', data.userId);
        const existingUserSnapshot = await transaction.get(existingUserQuery);

        if (!existingUserSnapshot.empty) {
            throw new Error('UserID already exists');
        }

        const salt = await bcrypt.genSalt(saltRounds);
        data.passwordHash = await bcrypt.hash(data.passwordHash, salt);

        await transaction.set(usersDb.doc(), data);
    });
};

// Firestore circuit breaker
const firestoreBreaker = new opossum(registerUserWithTransaction, circuitOptions);
firestoreBreaker.fallback(() => { throw new Error('Firestore service unavailable'); });

// Endpoints
app.get('/register_user', (req, res) => {
    res.sendFile(__dirname + '/public/register.html');
});

app.post('/register_user', async (req, res) => {
    const data = req.body;

    try {
        await firestoreBreaker.fire(data);
        await queueBreaker.fire(data.userId); // Send userId to RabbitMQ
        res.status(200).json({ message: 'Registration successful', redirectUrl: 'http://localhost:5069/home' });
    } catch (err) {
        if (err.message === 'UserID already exists') {
            res.status(400).json({ error: err.message });
        } else if (err.message === 'Firestore service unavailable') {
            res.status(503).json({ error: 'Service unavailable. Please try again later.' });
        } else {
            console.error(err);
            res.status(500).json({ error: 'Failed to post data to Firebase' });
        }
    }
});

app.get('/login', (req, res) => {
    res.sendFile(__dirname + '/public/login.html');
});

app.post('/login', async (req, res) => {
    try {
        const { userId, passwordHash } = req.body;
        if (!userId || !passwordHash) {
            return res.status(400).json({ error: 'UserID and password are required' });
        }

        const snapshot = await usersDb.where('userId', '==', userId).get();
        if (snapshot.empty) {
            return res.status(400).json({ error: 'User not found' });
        }

        let userData;
        snapshot.forEach(doc => {
            userData = doc.data();
        });

        const isMatch = await bcrypt.compare(passwordHash, userData.passwordHash);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid password' });
        }

        await queueBreaker.fire(userId); // Send userId to RabbitMQ if login is successful
        return res.status(200).json({
            message: 'Login successful',
            redirectUrl: 'http://localhost:5069/home'
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: 'Failed to login' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on PORT ${PORT}.`);
});
