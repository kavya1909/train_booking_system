import pika

connection = pika.BlockingConnection(pika.ConnectionParameters('localhost'))
channel = connection.channel()

channel.queue_purge(queue='book_queue')

connection.close()

print("Queue has been purged")
