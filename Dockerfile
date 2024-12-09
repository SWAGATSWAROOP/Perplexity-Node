FROM node:22-alpine3.19

WORKDIR /

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

CMD ["sh", "-c", "exec node index.js"]