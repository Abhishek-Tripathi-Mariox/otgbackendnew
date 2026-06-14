# OTG Admin Panel - Backend

Node.js + Express.js + MongoDB backend with TypeScript.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start development server
npm run dev
```

## Environment Variables

| Variable       | Description              | Default                                    |
|----------------|--------------------------|-------------------------------------------|
| PORT           | Server port              | 5000                                      |
| NODE_ENV       | Environment              | development                               |
| MONGODB_URI    | MongoDB connection URI   | mongodb://localhost:27017/otg_admin_panel |
| JWT_SECRET     | JWT signing secret       | -                                         |
| JWT_EXPIRES_IN | JWT expiration           | 7d                                        |
| ADMIN_EMAIL    | Default admin email      | admin@example.com                         |
| ADMIN_PASSWORD | Default admin password   | Admin@123                                 |
# otgbackendnew
