FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
COPY wait-for-rabbitmq.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/wait-for-rabbitmq.sh
EXPOSE 3001
CMD ["sh", "-c", "wait-for-rabbitmq.sh rabbitmq 5672 && node index.js"]