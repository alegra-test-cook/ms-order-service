const express = require('express');
const amqp = require('amqplib');
const { MongoClient, ObjectId } = require('mongodb');

// Importar configuraciones
const { PORT, RABBIT_URL, MONGO_URL, QUEUE_NAMES, COLLECTIONS, ORDER_STATUS } = require('./config');

const app = express();
app.use(express.json());

async function start() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  const db = client.db('restaurant');
  const ordersColl = db.collection(COLLECTIONS.ORDERS);

  const connection = await amqp.connect(RABBIT_URL);
  const channel = await connection.createChannel();
  await channel.assertQueue(QUEUE_NAMES.ORDERS);
  await channel.assertQueue(QUEUE_NAMES.ORDER_DONE);

  channel.consume(QUEUE_NAMES.ORDER_DONE, async (msg) => {
    if (!msg) return;
    const { orderId, dish, image, description } = JSON.parse(msg.content.toString());
    try {
      await ordersColl.updateOne(
        { _id: new ObjectId(orderId) },
        { 
          $set: { 
            status: ORDER_STATUS.COMPLETED, 
            dish: dish, 
            image: image,
            description: description,
            finishedAt: new Date() 
          } 
        }
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
        status: ORDER_STATUS.IN_PROGRESS,
        createdAt: new Date()
      };
      const result = await ordersColl.insertOne(newOrder);
      const orderId = result.insertedId.toString();
      console.log(`➕ Nuevo pedido recibido. ID: ${orderId}`);
      const msg = { orderId: orderId };
      channel.sendToQueue(QUEUE_NAMES.ORDERS, Buffer.from(JSON.stringify(msg)));
      res.status(202).json({ orderId: orderId, status: ORDER_STATUS.IN_PROGRESS });
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
        image: order.image || null,
        description: order.description || null,
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
        image: order.image || null,
        description: order.description || null,
        createdAt: order.createdAt,
        finishedAt: order.finishedAt || null
      }));
      res.json(response);
    } catch (error) {
      console.error('✘ Error al listar pedidos:', error);
      res.status(500).send('Error del servidor');
    }
  });

  // Endpoint para obtener detalles completos de un pedido
  app.get('/orders/:id/details', async (req, res) => {
    try {
      const orderId = req.params.id;
      const order = await ordersColl.findOne({ _id: new ObjectId(orderId) });
      
      if (!order) {
        return res.status(404).send('Pedido no encontrado');
      }
      
      // Si el pedido está completado, devolvemos toda la información
      if (order.status === ORDER_STATUS.COMPLETED) {
        const detailedResponse = {
          orderId: order._id.toString(),
          status: order.status,
          createdAt: order.createdAt,
          finishedAt: order.finishedAt,
          dish: {
            name: order.dish,
            image: order.image,
            description: order.description
          },
          processingTime: order.finishedAt ? 
            Math.round((order.finishedAt - order.createdAt) / 1000) : null // Tiempo en segundos
        };
        return res.json(detailedResponse);
      }
      
      // Si el pedido aún está en proceso
      return res.json({
        orderId: order._id.toString(),
        status: order.status,
        createdAt: order.createdAt,
        message: "El pedido aún está en preparación."
      });
      
    } catch (error) {
      console.error('✘ Error al obtener detalles del pedido:', error);
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