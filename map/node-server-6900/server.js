const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const amqp = require('amqplib');
const path = require('path');
const opossum = require('opossum');

const app = express();
app.use(express.json());

const uri = "mongodb+srv://21bce125:2003@cluster0.h8s4r.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
    tlsAllowInvalidCertificates: true
});


let globalUserId = null;
let globalTrainId = null;

// Circuit breaker options
const breakerOptions = {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000
};

// MongoDB Circuit Breaker
const mongoBreaker = new opossum(async () => {
    await client.connect();
    return client.db("map").collection("seats");
}, breakerOptions);

mongoBreaker.fallback(() => {
    console.error("MongoDB service is currently unavailable.");
    return null;
});

// RabbitMQ Circuit Breaker
const rabbitBreaker = new opossum(async () => {
    const connection = await amqp.connect(amqpUri);
    return connection.createChannel();
}, breakerOptions);

rabbitBreaker.fallback(() => {
    console.error("RabbitMQ service is currently unavailable.");
    return null;
});

// Firebase Circuit Breaker (for Firebase authentication tasks)
const firebaseBreaker = new opossum(async (userId) => {
    const user = await firebaseAdmin.auth().getUser(userId);
    return user;
}, breakerOptions);

firebaseBreaker.fallback(() => {
    console.error("Firebase service is currently unavailable.");
    return null;
});

// RabbitMQ connection and consumer setup
async function connectToRabbitMQ() {
    try {
        const connection = await amqp.connect('amqp://localhost');
        const channel = await connection.createChannel();
        const queue = 'book_queue';

        await channel.assertQueue(queue, { durable: true });

        channel.consume(queue, async (msg) => {
            if (msg !== null) {
                const { userId, trainId } = JSON.parse(msg.content.toString().replace(/'/g, '"'));
                console.log(`Received message: userId=${userId}, trainId=${trainId}`);

                // Set global variables
                globalUserId = userId;
                globalTrainId = parseInt(trainId);

                channel.ack(msg);
            }
        });
    } catch (error) {
        console.error("Error connecting to RabbitMQ:", error);
    }
}

connectToRabbitMQ();

app.get('/view_seats', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/view_seats.html'));
});

app.get('/book_seat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/book_seat.html'));
});

app.get('/seats', async (req, res) => {
    if (!globalTrainId) {
        console.error("Train ID not available.");
        return res.status(400).json({ message: "Train information not available", availableSeats: [] });
    }

    try {
        await client.connect();
        const seatsCollection = client.db("map").collection("seats");
        const seatData = await seatsCollection.findOne({ trainId: globalTrainId });

        if (!seatData) {
            console.error("Train not found in database.");
            return res.status(404).json({ message: "Train not found", availableSeats: [] });
        }

        const availableSeats = seatData.seat.map((isBooked, index) => ({ seatNumber: index + 1, available: !isBooked }));
        res.json({ trainId: globalTrainId, availableSeats });
    } catch (error) {
        console.error("Error fetching seats:", error);
        res.status(500).json({ message: "Server error", availableSeats: [] });
    } finally {
        await client.close();
    }
});


app.post('/book', async (req, res) => {
    const seatNumber = req.body.seatNumber;
    
    if (!globalUserId || !globalTrainId) {
        return res.status(400).json({ message: "Booking information not available" });
    }

    if (seatNumber < 1) {
        return res.status(400).json({ message: "Invalid seat number" });
    }

    try {
        await client.connect();
        const seatsCollection = client.db("map").collection("seats");
        const bookingsCollection = client.db("map").collection("booking");

        const seatData = await seatsCollection.findOne({ trainId: globalTrainId });
        if (!seatData) {
            return res.status(404).json({ message: "Train not found" });
        }

        if (seatData.seat[seatNumber - 1]) {
            return res.status(400).json({ message: "Seat already booked" });
        }

        const updatedSeats = [...seatData.seat];
        updatedSeats[seatNumber - 1] = true;
        await seatsCollection.updateOne(
            { trainId: globalTrainId },
            { $set: { seat: updatedSeats } }
        );

        await bookingsCollection.insertOne({ userId: globalUserId, trainId: globalTrainId, seatNumber });

        res.json({ message: "Seat booked successfully", trainId: globalTrainId, seatNumber });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        await client.close();
    }
});

const PORT = 6900;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
