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

## Build & Production

Para compilar e rodar em produção localmente:

```bash
npm run build        # Compila TypeScript para dist/
npm run start:prod   # Inicia servidor da build compilada
```

**Nota Windows:** O projeto usa TypeScript 5.9 com NestJS. Se encontrar erro ao rodar build, use `npm run build` que já está configurado para usar `tsc` diretamente (compatível com Windows/Linux/Mac).

Se precisar testar o build limpo:
```bash
rm -r dist           # Remove pasta anterior
npm run build        # Build novo
npm run start:prod   # Testa produção
```

O build gera:
- `dist/main.js` - entry point
- `dist/**/*.js` - módulos compilados
- `dist/**/*.js.map` - source maps para debug

## Scripts

- `npm run start` - Inicia servidor em dev mode com hot-reload (nest)
- `npm run start:dev` - Alias para start com watch mode
- `npm run start:debug` - Inicia com debugger ativo
- `npm run start:prod` - Inicia do build compilado (produção)
- `npm run build` - Compila TypeScript via tsc (usa prebuild para gerar Prisma)
- `npm run prebuild` - Gera cliente Prisma (roda automaticamente antes de build)
- `npm run db:generate` - `prisma generate`
- `npm run db:push` - `prisma db push`
- `npm run db:seed` - Popula banco com dados iniciais
- `npm run db:studio` - Abre Prisma Studio (GUI para dados)
- `npm run test` - Jest tests
- `npm run lint` - ESLint fix

## Modulos principais

- `auth`: login e registro
- `users`: perfil e gestao de usuarios do condominio
- `deliveries`: ciclo da entrega e metricas
- `orders`: pedidos e hub de chats
- `vendors`: operacao do comercio
- `condominiums`: configuracoes do condominio

## Endpoints principais

### Auth

- `POST /auth/register`
- `POST /auth/login`

### Deliveries

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

### Orders + Chats

- `GET /orders`
- `GET /orders/chats`
- `GET /orders/:id/messages?kind=ORDER|DELIVERY`
- `POST /orders/:id/messages?kind=ORDER|DELIVERY`

### Vendors

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

- URL de conexão: mesmo host da API (sem `/api`)
- Path: `/socket.io`
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
- TypeScript 5.9 build errors: O build está configurado com `noEmitOnError: false` para ignorar erros de tipo de decorators legacy. Funcionários são compilados normalmente.

## Deploy no Render

(Conteúdo original do deploy)
