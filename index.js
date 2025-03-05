const express = require('express');
const amqp = require('amqplib');
const { MongoClient, ObjectId } = require('mongodb');

const PORT = process.env.PORT || 3001;
const RABBIT_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const MONGO_URL = process.env.MONGO_URL || 'mongodb+srv://heanfig:UBP3AqbGlPWEpdDn@alegra-test.kbne8.mongodb.net/?retryWrites=true&w=majority&appName=alegra-test';

const app = express();
app.use(express.json());

async function start() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  const db = client.db('restaurant');
  const ordersColl = db.collection('orders');

  const connection = await amqp.connect(RABBIT_URL);
  const channel = await connection.createChannel();
  await channel.assertQueue('orders');
  await channel.assertQueue('order_done');

  channel.consume('order_done', async (msg) => {
    if (!msg) return;
    const { orderId, dish } = JSON.parse(msg.content.toString());
    try {
      await ordersColl.updateOne(
        { _id: new ObjectId(orderId) },
        { $set: { status: 'finalizado', dish: dish, finishedAt: new Date() } }
      );
      console.log(`✔ Pedido ${orderId} marcado como finalizado (Plato: ${dish}).`);
    } catch (err) {
      console.error(`✘ Error actualizando pedido ${orderId}:`, err);
    }
    channel.ack(msg);
  });

  app.post('/orders', async (req, res) => {
    try {
      const newOrder = {
        status: 'en preparación',
        createdAt: new Date()
      };
      const result = await ordersColl.insertOne(newOrder);
      const orderId = result.insertedId.toString();
      console.log(`➕ Nuevo pedido recibido. ID: ${orderId}`);
      const msg = { orderId: orderId };
      channel.sendToQueue('orders', Buffer.from(JSON.stringify(msg)));
      res.status(202).json({ orderId: orderId, status: 'en preparación' });
    } catch (error) {
      console.error('✘ Error al crear nuevo pedido:', error);
      res.status(500).send('Error al procesar el pedido');
    }
  });

  app.get('/orders/:id', async (req, res) => {
    try {
      const orderId = req.params.id;
      const order = await ordersColl.findOne({ _id: new ObjectId(orderId) });
      if (!order) {
        return res.status(404).send('Pedido no encontrado');
      }
      res.json({
        orderId: order._id.toString(),
        status: order.status,
        dish: order.dish || null,
        createdAt: order.createdAt,
        finishedAt: order.finishedAt || null
      });
    } catch (error) {
      console.error('✘ Error al obtener pedido:', error);
      res.status(500).send('Error del servidor');
    }
  });

  app.get('/orders', async (req, res) => {
    try {
      const orders = await ordersColl.find().toArray();
      const response = orders.map(order => ({
        orderId: order._id.toString(),
        status: order.status,
        dish: order.dish || null,
        createdAt: order.createdAt,
        finishedAt: order.finishedAt || null
      }));
      res.json(response);
    } catch (error) {
      console.error('✘ Error al listar pedidos:', error);
      res.status(500).send('Error del servidor');
    }
  });

  app.listen(PORT, () => {
    console.log(`🚀 Servicio de Pedidos escuchando en puerto ${PORT}`);
  });
}

start().catch(err => {
  console.error('✘ Error iniciando el Servicio de Pedidos:', err);
  process.exit(1);
});