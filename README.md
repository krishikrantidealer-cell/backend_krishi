# Krishi Auth Backend Documentation

## Overview
This is a production-ready authentication backend built with Node.js, Express, MongoDB, and Redis. It implements a secure OTP-based login system with device session management and JWT refresh token rotation.

## Features & Security Decisions

### 1. OTP Authentication
- **Storage**: OTPs are stored in Redis only, never in the persistent database.
- **Security**: OTPs are hashed using bcrypt before being stored in Redis to prevent exposure if Redis is compromised.
- **Rate Limiting**: 
    - Max 2 OTP sends per 10 minutes per phone number (preventing SMS cost abuse).
    - Max 3 verification attempts per OTP (preventing brute-force).
- **Single Use**: OTP is deleted immediately upon successful verification.
- **Expiry**: OTPs expire automatically after 5 minutes using Redis TTL.

### 2. JWT & Session Management
- **Access Token**: Short-lived (15 mins) for security.
- **Refresh Token**: Long-lived (30 days) with **Rotation**. On every refresh, a new token is issued and the old one is invalidated.
- **Reuse Detection**: If an old refresh token is reused, the system detects it (by comparing hashes) and invalidates ALL sessions for that user as a security measure.
- **Device Management**: 
    - Maximum 3 concurrent active devices per user.
    - Automatic removal of the oldest session when a 4th device logs in.
    - Sessions store metadata like IP, User-Agent, and Last Used timestamp.

### 3. API Security
- **Helmet**: Adds security headers to protect against common web vulnerabilities.
- **CORS**: Configured for restricted access (should be tightened in production).
- **Rate Limiting**: IP-based rate limiting for general API and specific auth endpoints.
- **Validation**: Strict input validation using `express-validator`.

---

## Example Request/Response Formats

### 1. Send OTP
**POST** `/api/auth/send-otp`
```json
{
  "phoneNumber": "+919876543210"
}
```
**Response (200 OK)**
```json
{
  "success": true,
  "message": "OTP sent successfully"
}
```

### 2. Verify OTP (Login/Register)
**POST** `/api/auth/verify-otp`
```json
{
  "phoneNumber": "+919876543210",
  "otp": "123456",
  "deviceId": "unique-uuid-per-device"
}
```
**Response (200 OK)**
```json
{
  "success": true,
  "user": {
    "id": "60d...",
    "phoneNumber": "+919876543210",
    "role": "user"
  },
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG..."
}
```

### 3. Refresh Token
**POST** `/api/auth/refresh`
```json
{
  "refreshToken": "eyJhbG..."
}
```
**Response (200 OK)**
```json
{
  "success": true,
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG..."
}
```

### 4. Logout
**POST** `/api/auth/logout`
**Headers**: `Authorization: Bearer <accessToken>`
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## Folder Structure
- `config/`: DB and Redis connections.
- `controllers/`: Request handling logic.
- `models/`: Mongoose schemas.
- `middlewares/`: Security, auth, and validation.
- `routes/`: API endpoint definitions.
- `services/`: Business logic (OTP, Token logic).
- `utils/`: Reusable helpers (JWT, Hashing).
