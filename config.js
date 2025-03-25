/**
 * Configuración del Microservicio de Órdenes
 */

// Configuración del servidor
const PORT = process.env.PORT || 3001;

// Configuración de la conexión a RabbitMQ
const RABBIT_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

// Configuración de la conexión a MongoDB
const MONGO_URL = process.env.MONGO_URL || 'mongodb+srv://heanfig:UBP3AqbGlPWEpdDn@alegra-test.kbne8.mongodb.net/?retryWrites=true&w=majority&appName=alegra-test';

// Nombres de colas
const QUEUE_NAMES = {
  ORDERS: 'orders',
  ORDER_DONE: 'order_done'
};

// Nombres de las colecciones en MongoDB
const COLLECTIONS = {
  ORDERS: 'orders',
  LOGS: 'system_logs'
};

// Estados de los pedidos
const ORDER_STATUS = {
  IN_PROGRESS: 'en preparación',
  COMPLETED: 'finalizado'
};

// Exportar configuraciones
module.exports = {
  PORT,
  RABBIT_URL,
  MONGO_URL,
  QUEUE_NAMES,
  COLLECTIONS,
  ORDER_STATUS
}; 