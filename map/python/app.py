from flask import Flask, jsonify, request, render_template, redirect, session, url_for
import mysql.connector
import pika
import threading
import datetime

app = Flask(__name__)

# Database connection
dbr = mysql.connector.connect(
    host='localhost',
    user='root',
    database='MAP',
    password='2003'
)
cr = dbr.cursor(dictionary=True)


def consume_from_queue():
    connection = pika.BlockingConnection(pika.ConnectionParameters('localhost'))
    channel = connection.channel()

    channel.queue_declare(queue='user_queue', durable=True)

    def callback(ch, method, properties, body):
        global userId
        user_id = body.decode('utf-8')
        print(f"Received userId: {user_id}")
        with app.app_context():
            with open(r'C:\Users\kotad\OneDrive\Desktop\map\python\a.txt', 'a+') as f:
                f.write(user_id)
            print("Message received and processed within app context.")

    channel.basic_consume(queue='user_queue', on_message_callback=callback, auto_ack=True)
    print('Waiting for messages. To exit press CTRL+C')
    channel.start_consuming()


def send_to_queue(user_id, train_id):
    connection = pika.BlockingConnection(pika.ConnectionParameters('localhost'))
    channel = connection.channel()
    channel.queue_declare(queue='book_queue', durable=True)
    message = {"userId": user_id, "trainId": train_id}
    channel.basic_publish(
        exchange='',
        routing_key='book_queue',
        body=str(message)
    )
    print(f"Sent message to queue: {message}")
    connection.close()


consumer_thread = threading.Thread(target=consume_from_queue)
consumer_thread.start()


@app.route('/home', methods=['GET'])
def home():
    return render_template('home.html')


@app.route('/search_trains_form', methods=['GET'])
def search_trains_form():
    return '''
    <form action="/search_trains" method="get">
        <label for="Source">Source:</label>
        <input type="text" id="Source" name="Source" required><br><br>
        <label for="Destination">Destination:</label>
        <input type="text" id="Destination" name="Destination" required><br><br>
        <input type="submit" value="Search Trains">
    </form>
    '''


@app.route('/show_trains', methods=['GET'])
def get_trains():
    try:
        cr.execute("SELECT * FROM trains;")
        trains = cr.fetchall()      
        for train in trains:
            for key, value in train.items():
                if isinstance(value, (datetime.timedelta, datetime.datetime)):
                    train[key] = str(value)

        # Render the template and pass the trains data
        return render_template('show_trains.html', trains=trains)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/search_trains', methods=['GET'])
def search_trains():
    source = request.args.get('Source')
    destination = request.args.get('Destination')

    if not source or not destination:
        return render_template('search_trains.html', error='Source and destination are required')

    try:
        cr.execute("SELECT * FROM Trains WHERE Source = %s AND Destination = %s", (source, destination))
        trains = cr.fetchall()
        print(trains)
        # Format date and time fields to strings if needed
        for train in trains:
            for key, value in train.items():
                if isinstance(value, (datetime.timedelta, datetime.datetime)):
                    train[key] = str(value)         
        if not trains:
            return render_template('search_trains.html', message='No trains found for the specified route')
        return render_template('search_trains.html', trains=trains)
    except Exception as e:
        return render_template('search_trains.html', error=str(e))


@app.route('/add_trains', methods=['POST'])
def insert_train():
    try:
        data = request.json
        prn_no = data.get('prn_no')
        name = data.get('Name')
        source = data.get('Source')
        destination = data.get('Destination')
        arrival = data.get('Arrival')
        price = data.get('Price')

        query = "INSERT INTO Trains (prn_no, Name, Source, Destination, Arrival, Price) VALUES (%s, %s, %s, %s, %s, %s)"
        values = (prn_no, name, source, destination, arrival, price)

        cr.execute(query, values)
        dbr.commit()

        return jsonify({'message': 'Train details inserted successfully'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/book_train', methods=['POST'])
def book_train():
    try:
        train_id = request.form.get('trainId')
        with open(r'C:\Users\kotad\OneDrive\Desktop\map\python\a.txt', 'r') as f:
            userId = f.readline()
            print(userId)
        send_to_queue(userId[-1], train_id)
        return jsonify({'message': 'Booking request sent successfully!'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(port=5069, debug=True)
