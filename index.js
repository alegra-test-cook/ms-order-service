const express = require('express');
const amqp = require('amqplib');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');

const { PORT, RABBIT_URL, MONGO_URL, QUEUE_NAMES, COLLECTIONS, ORDER_STATUS } = require('./config');
const logger = require('./logger');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

function isValidObjectId(id) {
  try {
    if (id === undefined || id === null) return false;
    return /^[0-9a-fA-F]{24}$/.test(id);
  } catch (e) {
    return false;
  }
}

async function start() {
  await logger.initLogger();
  
  await logger.info('order-service', 'Servicio de órdenes iniciado');
  
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  const db = client.db('restaurant');
  const ordersColl = db.collection(COLLECTIONS.ORDERS);

  const connection = await amqp.connect(RABBIT_URL);
  const channel = await connection.createChannel();
  await channel.assertQueue(QUEUE_NAMES.ORDERS);
  await channel.assertQueue(QUEUE_NAMES.ORDER_DONE);
  
  await channel.assertQueue('system_logs');
  
  channel.consume('system_logs', async (msg) => {
    if (!msg) return;
    try {
      const logData = JSON.parse(msg.content.toString());
      await logger.getLogs();
      
      const logsColl = client.db().collection(COLLECTIONS.LOGS);
      await logsColl.insertOne(logData);
      
      channel.ack(msg);
    } catch (err) {
      await logger.error('order-service', 'Error procesando log de otro servicio', { error: err.message });
      channel.ack(msg);
    }
  });

  channel.consume(QUEUE_NAMES.ORDER_DONE, async (msg) => {
    if (!msg) return;
    try {
      const { orderId, dish, image, description } = JSON.parse(msg.content.toString());
      
      if (!isValidObjectId(orderId)) {
        await logger.error('order-service', `ID de orden inválido en mensaje ORDER_DONE: ${orderId}`);
        channel.ack(msg);
        return;
      }
      
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
      await logger.info('order-service', `Pedido ${orderId} marcado como finalizado (Plato: ${dish}).`);
    } catch (err) {
      await logger.error('order-service', `Error actualizando pedido`, { error: err.message });
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
      await logger.info('order-service', `Nuevo pedido recibido. ID: ${orderId}`);
      const msg = { orderId: orderId };
      channel.sendToQueue(QUEUE_NAMES.ORDERS, Buffer.from(JSON.stringify(msg)));
      res.status(202).json({ orderId: orderId, status: ORDER_STATUS.IN_PROGRESS });
    } catch (error) {
      await logger.error('order-service', 'Error al crear nuevo pedido', { error: error.message });
      res.status(500).send('Error al procesar el pedido');
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
      await logger.error('order-service', 'Error al listar pedidos', { error: error.message });
      res.status(500).send('Error del servidor');
    }
  });

  app.get('/orders/logs', async (req, res) => {
    try {
      const { 
        service, 
        level, 
        limit = 100, 
        skip = 0,
        startDate,
        endDate
      } = req.query;
      
      const filter = {};
      
      if (service) {
        filter.service = service;
      }
      
      if (level) {
        filter.level = level;
      }
      
      if (startDate || endDate) {
        filter.timestamp = {};
        if (startDate) {
          filter.timestamp.$gte = new Date(startDate);
        }
        if (endDate) {
          filter.timestamp.$lte = new Date(endDate);
        }
      }
      
      const logs = await logger.getLogs(
        filter, 
        parseInt(limit),
        parseInt(skip)
      );
      
      res.json(logs);
    } catch (error) {
      await logger.error('order-service', `Error al consultar logs: ${error.message}`);
      res.status(500).send('Error al consultar logs');
    }
  });

  app.get('/orders/:id', async (req, res) => {
    try {
      const orderId = req.params.id;
      
      if (!isValidObjectId(orderId)) {
        await logger.warning('order-service', `Intento de consulta con ID inválido: ${orderId}`);
        return res.status(400).json({ 
          error: 'ID de orden inválido',
          message: 'El ID proporcionado no es un ObjectId de MongoDB válido'
        });
      }
      
      const order = await ordersColl.findOne({ _id: new ObjectId(orderId) });
      if (!order) {
        await logger.warning('order-service', `Pedido no encontrado con ID: ${orderId}`);
        return res.status(404).send('Pedido no encontrado');
      }
      
      await logger.info('order-service', `Pedido consultado: ${orderId}`);
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
      await logger.error('order-service', 'Error al obtener pedido', { error: error.message, orderId: req.params.id });
      res.status(500).send('Error del servidor');
    }
  });

  app.get('/orders/:id/details', async (req, res) => {
    try {
      const orderId = req.params.id;
      
      if (!isValidObjectId(orderId)) {
        await logger.warning('order-service', `Intento de consulta de detalles con ID inválido: ${orderId}`);
        return res.status(400).json({ 
          error: 'ID de orden inválido',
          message: 'El ID proporcionado no es un ObjectId de MongoDB válido'
        });
      }
      
      const order = await ordersColl.findOne({ _id: new ObjectId(orderId) });
      
      if (!order) {
        await logger.warning('order-service', `Detalles de pedido no encontrado con ID: ${orderId}`);
        return res.status(404).send('Pedido no encontrado');
      }
      
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
            Math.round((order.finishedAt - order.createdAt) / 1000) : null
        };
        await logger.info('order-service', `Detalles de pedido completado consultados: ${orderId}`);
        return res.json(detailedResponse);
      }
      
      await logger.info('order-service', `Detalles de pedido en preparación consultados: ${orderId}`);
      return res.json({
        orderId: order._id.toString(),
        status: order.status,
        createdAt: order.createdAt,
        message: "El pedido aún está en preparación."
      });
      
    } catch (error) {
      await logger.error('order-service', 'Error al obtener detalles del pedido', { error: error.message, orderId: req.params.id });
      res.status(500).send('Error del servidor');
    }
  });

  app.get('/logs', async (req, res) => {
    try {
      const { 
        service, 
        level, 
        limit = 100, 
        skip = 0,
        startDate,
        endDate
      } = req.query;
      
      const filter = {};
      
      if (service) {
        filter.service = service;
      }
      
      if (level) {
        filter.level = level;
      }
      
      if (startDate || endDate) {
        filter.timestamp = {};
        if (startDate) {
          filter.timestamp.$gte = new Date(startDate);
        }
        if (endDate) {
          filter.timestamp.$lte = new Date(endDate);
        }
      }
      
      const logs = await logger.getLogs(
        filter, 
        parseInt(limit),
        parseInt(skip)
      );
      
      res.json(logs);
    } catch (error) {
      await logger.error('order-service', `Error al consultar logs: ${error.message}`);
      res.status(500).send('Error al consultar logs');
    }
  });

  app.listen(PORT, () => {
    logger.info('order-service', `Servicio de Pedidos escuchando en puerto ${PORT}`);
  });
}

start().catch(async err => {
  try {
    await logger.error('order-service', `Error iniciando el Servicio de Pedidos: ${err.message}`, { stack: err.stack });
  } catch (logError) {
    console.error('✘ Error iniciando el Servicio de Pedidos:', err);
    console.error('Error adicional al intentar registrar el error:', logError);
  }
  process.exit(1);
});