FROM node:16-alpine3.15

RUN apk add --no-cache python3 make gcc g++ libc-dev

WORKDIR /app

COPY . .

RUN npm install

VOLUME /app/.data
EXPOSE 8080

ENTRYPOINT ["node"]
CMD ["server.js"]
