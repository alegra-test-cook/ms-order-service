set -e

host="$1"
port="$2"
shift 2

echo "Esperando a que RabbitMQ esté disponible en $host:$port..."
while ! nc -z "$host" "$port"; do
  sleep 2
done

echo "RabbitMQ está listo. Iniciando el servicio..."
exec "$@"