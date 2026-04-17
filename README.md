# NSP Backend

API do projeto Na Sua Porta.

Stack: NestJS + Prisma + PostgreSQL + JWT + Socket.IO.

## Setup rapido

```bash
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm run start:dev
```

Base URL local: `http://localhost:3000/api`

## Scripts

- `npm run start`
- `npm run start:dev`
- `npm run build`
- `npm run test`
- `npm run db:generate`
- `npm run db:push`
- `npm run db:seed`
- `npm run db:studio`

## Modulos principais

- `auth`: login e registro
- `users`: perfil e gestao de usuarios do condominio
- `deliveries`: ciclo da entrega e metricas
- `orders`: pedidos e hub de chats
- `vendors`: operacao do comercio
- `condominiums`: configuracoes do condominio

## Endpoints principais

## Auth

- `POST /auth/register`
- `POST /auth/login`

## Deliveries

- `POST /deliveries`
- `GET /deliveries`
- `GET /deliveries/available`
- `GET /deliveries/my-deliveries`
- `GET /deliveries/history`
- `GET /deliveries/stats`
- `PATCH /deliveries/:id/accept`
- `PATCH /deliveries/:id/status`
- `PATCH /deliveries/:id/cancel`
- `PATCH /deliveries/:id/rate`

## Orders + Chats

- `GET /orders`
- `GET /orders/chats`
- `GET /orders/:id/messages?kind=ORDER|DELIVERY`
- `POST /orders/:id/messages?kind=ORDER|DELIVERY`

## Vendors

- `GET /vendors/me/orders`
- `PATCH /vendors/me/orders/:orderId/status`
- `PATCH /vendors/me/orders/:orderId/cancel`
- `GET /vendors/me/orders/:orderId/messages`
- `POST /vendors/me/orders/:orderId/messages`

## Regras de negocio importantes

- Entrega: `REQUESTED -> ACCEPTED -> PICKED_UP -> DELIVERED`
- Pedido comercio: `PENDING -> ACCEPTED -> READY -> SENT -> COMPLETED`
- Janela de cancelamento do comercio: **2 minutos apos aceite** (`acceptedAt`).
- Chat de entrega e pedido em tempo real, com retencao de 7 dias.

## Eventos Socket.IO

- `delivery_created`
- `delivery_accepted`
- `delivery_updated`
- `delivery_cancelled`
- `order_created`
- `order_updated`
- `order_message`
- `delivery_message`

## Troubleshooting

- `EADDRINUSE :3000`: finalize processo anterior antes de iniciar novo servidor.
- Erro de schema Prisma: rode `npm run db:push` e `npm run db:generate`.

## Deploy no Render

- Root Directory: `NSP - Backend`
- Build Command: `npm install --include=dev && npm run db:push && npm run build`
- Start Command: `npm run start:prod`

Variaveis obrigatorias:

- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `CORS_ORIGINS` (lista separada por vírgula, ex: `http://localhost:3001,https://app.nasuaporta.com.br`) ou `CORS_ORIGIN` para compatibilidade
