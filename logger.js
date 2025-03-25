/**
 * Módulo de logging centralizado
 */
const { MongoClient } = require('mongodb');
const { MONGO_URL, COLLECTIONS } = require('./config');

// Conexión a MongoDB
let logsCollection = null;

// Inicializar la conexión a MongoDB
async function initLogger() {
  try {
    if (logsCollection) return;
    
    const client = new MongoClient(MONGO_URL);
    await client.connect();
    const db = client.db();
    logsCollection = db.collection(COLLECTIONS.LOGS);
    
    console.log('✅ Logger conectado a MongoDB');
  } catch (error) {
    console.error('❌ Error conectando el logger a MongoDB:', error);
  }
}

// Función para registrar un log
async function logEvent(service, level, message, data = {}) {
  try {
    if (!logsCollection) {
      await initLogger();
    }
    
    const logEntry = {
      timestamp: new Date(),
      service,
      level,
      message,
      data,
    };
    
    await logsCollection.insertOne(logEntry);
    
    // También imprimimos en la consola para debugging
    console.log(`[${service}] [${level}] ${message}`);
    
    return true;
  } catch (error) {
    console.error('❌ Error registrando log:', error);
    return false;
  }
}

// Métodos por nivel de log
const logger = {
  initLogger,
  info: (service, message, data) => logEvent(service, 'info', message, data),
  warning: (service, message, data) => logEvent(service, 'warning', message, data),
  error: (service, message, data) => logEvent(service, 'error', message, data),
  debug: (service, message, data) => logEvent(service, 'debug', message, data),
  
  // Obtener logs (para el endpoint)
  getLogs: async (filter = {}, limit = 100, skip = 0, sort = { timestamp: -1 }) => {
    if (!logsCollection) {
      await initLogger();
    }
    
    return logsCollection.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .toArray();
  }
};

module.exports = logger; 