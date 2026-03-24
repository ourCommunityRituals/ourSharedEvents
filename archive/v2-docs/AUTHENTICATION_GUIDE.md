# Authentication Guide

## 🔐 Overview

The MVP Event Toolkit API supports **three authentication methods**, giving you flexibility to choose the approach that best fits your use case:

1. **Admin Key** (Legacy) - Simple secret key
2. **Bearer Token (JWT)** - Token-based authentication
3. **API Key Header** - X-API-Key header

All three methods work simultaneously, so you can use different methods for different clients.

---

## Method 1: Admin Key (Legacy)

Simple secret key passed in the request body. Best for quick testing and internal tools.

### How It Works

Include the `adminKey` in your POST request body:

```json
{
  "action": "create",
  "brandId": "root",
  "adminKey": "YOUR_ADMIN_SECRET",
  "data": { ... }
}
```

### Example (JavaScript)

```javascript
const response = await fetch(BASE_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'create',
    brandId: 'root',
    adminKey: 'YOUR_ADMIN_SECRET',
    scope: 'events',
    templateId: 'Event',
    data: {
      eventName: 'Summer Concert',
      eventDate: '2025-07-15'
    }
  })
});
```

### Pros & Cons

✅ **Pros:**
- Simple and straightforward
- No token management required
- Works for all operations

❌ **Cons:**
- Secret exposed in every request
- No expiration
- Cannot revoke without changing secret
- Less secure for public frontends

### Best For:
- Quick testing
- Internal tools
- Server-to-server communication
- Trusted environments

---

## Method 2: Bearer Token (JWT)

Token-based authentication using JSON Web Tokens. Best for production applications and mobile apps.

### How It Works

1. **Generate a token** using your admin key
2. **Use the token** in the Authorization header for subsequent requests
3. **Token expires** after the specified time (default: 1 hour)

### Step 1: Generate Token

```bash
POST {BASE_URL}
Content-Type: application/json

{
  "action": "generateToken",
  "brandId": "root",
  "adminKey": "YOUR_ADMIN_SECRET",
  "expiresIn": 3600,
  "scope": "events"
}
```

**Response:**
```json
{
  "ok": true,
  "value": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 3600,
    "expiresAt": "2025-11-10T15:30:00.000Z",
    "usage": "Authorization: Bearer {token}"
  }
}
```

### Step 2: Use Token

```bash
POST {BASE_URL}
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "action": "create",
  "brandId": "root",
  "scope": "events",
  "templateId": "Event",
  "data": {
    "eventName": "Summer Concert"
  }
}
```

### Example (JavaScript)

```javascript
// Step 1: Generate token (do this once, reuse until expired)
async function getToken() {
  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'generateToken',
      brandId: 'root',
      adminKey: 'YOUR_ADMIN_SECRET',
      expiresIn: 3600
    })
  });

  const result = await response.json();
  if (result.ok) {
    return result.value.token;
  }
  throw new Error('Failed to generate token');
}

// Step 2: Use token for API calls
async function createEvent(token) {
  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      action: 'create',
      brandId: 'root',
      scope: 'events',
      templateId: 'Event',
      data: {
        eventName: 'Summer Concert',
        eventDate: '2025-07-15'
      }
    })
  });

  return response.json();
}

// Usage
const token = await getToken();
const event = await createEvent(token);
```

### Token Management Best Practices

```javascript
class TokenManager {
  constructor(baseUrl, adminKey) {
    this.baseUrl = baseUrl;
    this.adminKey = adminKey;
    this.token = null;
    this.expiresAt = null;
  }

  async getToken() {
    // Return cached token if still valid
    if (this.token && this.expiresAt && new Date() < new Date(this.expiresAt)) {
      return this.token;
    }

    // Generate new token
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'generateToken',
        brandId: 'root',
        adminKey: this.adminKey,
        expiresIn: 3600
      })
    });

    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.message);
    }

    this.token = result.value.token;
    this.expiresAt = result.value.expiresAt;

    return this.token;
  }

  async request(action, data) {
    const token = await this.getToken();

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action,
        brandId: 'root',
        ...data
      })
    });

    const result = await response.json();

    // If token expired, refresh and retry once
    if (!result.ok && result.message?.includes('expired')) {
      this.token = null; // Invalidate cached token
      const newToken = await this.getToken();

      // Retry request with new token
      const retryResponse = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${newToken}`
        },
        body: JSON.stringify({
          action,
          brandId: 'root',
          ...data
        })
      });

      return retryResponse.json();
    }

    return result;
  }
}

// Usage
const tokenManager = new TokenManager(BASE_URL, 'YOUR_ADMIN_SECRET');

// All requests automatically handle token generation and refresh
const event = await tokenManager.request('create', {
  scope: 'events',
  templateId: 'Event',
  data: {
    eventName: 'Summer Concert'
  }
});
```

### Pros & Cons

✅ **Pros:**
- More secure (admin key only used once)
- Tokens can expire
- Suitable for public frontends
- Standard approach (JWT)
- Can include additional claims

❌ **Cons:**
- Requires token management
- Needs refresh logic
- Extra request to generate token

### Best For:
- Production web applications
- Mobile apps
- Public-facing frontends
- Multi-user systems

---

## Method 3: API Key Header

API key passed in the `X-API-Key` header. Best for server-to-server integrations.

### How It Works

Include the `X-API-Key` header with your admin secret:

```bash
POST {BASE_URL}
Content-Type: application/json
X-API-Key: YOUR_ADMIN_SECRET

{
  "action": "create",
  "brandId": "root",
  "scope": "events",
  "templateId": "Event",
  "data": {
    "eventName": "Summer Concert"
  }
}
```

### Example (JavaScript)

```javascript
const response = await fetch(BASE_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'YOUR_ADMIN_SECRET'
  },
  body: JSON.stringify({
    action: 'create',
    brandId: 'root',
    scope: 'events',
    templateId: 'Event',
    data: {
      eventName: 'Summer Concert'
    }
  })
});
```

### Example (cURL)

```bash
curl -X POST "https://script.google.com/.../exec" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_ADMIN_SECRET" \
  -d '{
    "action": "create",
    "brandId": "root",
    "scope": "events",
    "templateId": "Event",
    "data": {
      "eventName": "Summer Concert"
    }
  }'
```

### Pros & Cons

✅ **Pros:**
- Clean request body
- Standard HTTP header approach
- Easy to implement
- Works well with API gateways

❌ **Cons:**
- Secret in every request
- No expiration
- Cannot revoke without changing secret

### Best For:
- Server-to-server integrations
- Webhook endpoints
- Backend services
- CI/CD pipelines

---

## Comparison Table

| Feature | Admin Key | Bearer Token (JWT) | API Key Header |
|---------|-----------|-------------------|----------------|
| **Security** | ⚠️ Medium | ✅ High | ⚠️ Medium |
| **Setup Complexity** | ✅ Simple | ⚠️ Moderate | ✅ Simple |
| **Token Expiration** | ❌ No | ✅ Yes | ❌ No |
| **Revocation** | ❌ Hard | ✅ Easy | ❌ Hard |
| **Best For** | Testing | Production | Server-to-Server |
| **Frontend Safe** | ❌ No | ✅ Yes | ❌ No |

---

## Security Best Practices

### 1. Never Expose Admin Keys in Frontend Code

❌ **Bad:**
```javascript
const ADMIN_KEY = 'my-secret-key'; // Don't hardcode!
```

✅ **Good:**
```javascript
// Use environment variables
const ADMIN_KEY = process.env.REACT_APP_ADMIN_KEY;

// Or use JWT tokens for frontend
const token = await generateToken();
```

### 2. Use HTTPS Only

Always use `https://` URLs, never `http://`.

### 3. Rotate Secrets Regularly

Change your admin secrets periodically:

```javascript
// In Config.gs
{
  id: 'root',
  adminSecret: 'new-secret-2025-11', // Update regularly
  // ...
}
```

### 4. Use Short-Lived Tokens

For public frontends, use short expiration times:

```json
{
  "expiresIn": 900  // 15 minutes
}
```

### 5. Store Tokens Securely

```javascript
// ❌ Don't store in localStorage (XSS vulnerable)
localStorage.setItem('token', token);

// ✅ Use memory or secure storage
class SecureTokenStorage {
  constructor() {
    this.token = null; // In-memory only
  }

  setToken(token) {
    this.token = token;
  }

  getToken() {
    return this.token;
  }
}
```

### 6. Handle Token Expiration

Always check for token expiration errors and refresh:

```javascript
async function apiCall(action, data) {
  try {
    const response = await makeRequest(action, data);
    return response;
  } catch (error) {
    if (error.message.includes('expired')) {
      // Refresh token and retry
      await refreshToken();
      return makeRequest(action, data);
    }
    throw error;
  }
}
```

---

## Error Handling

All authentication failures return a consistent error:

```json
{
  "ok": false,
  "code": "BAD_INPUT",
  "message": "Invalid authentication credentials"
}
```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| Invalid authentication credentials | Wrong admin key | Check `Config.gs` for correct secret |
| Token expired | JWT past expiration | Generate new token |
| Token brand mismatch | JWT for different brand | Use correct brand ID |
| Invalid JWT format | Malformed token | Check token structure |
| Invalid token signature | Tampered token | Generate new token |

---

## Migration Guide

### From Admin Key to JWT

If you're currently using admin keys and want to migrate to JWT:

1. **Keep admin key working** (backward compatible)
2. **Add token generation** to your auth flow
3. **Update clients** one by one to use tokens
4. **Monitor** both authentication methods
5. **Deprecate** admin key once migration is complete

```javascript
// Before (admin key)
function createEvent(adminKey) {
  return fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      adminKey, // Old method
      data: { ... }
    })
  });
}

// After (JWT)
function createEvent(token) {
  return fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}` // New method
    },
    body: JSON.stringify({
      action: 'create',
      data: { ... }
    })
  });
}
```

---

## Testing Authentication

### Test All Three Methods

```bash
# Method 1: Admin Key
curl -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"action":"create","adminKey":"YOUR_SECRET","data":{...}}'

# Method 2: Bearer Token
TOKEN=$(curl -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"action":"generateToken","adminKey":"YOUR_SECRET"}' \
  | jq -r '.value.token')

curl -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"action":"create","data":{...}}'

# Method 3: API Key Header
curl -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_SECRET" \
  -d '{"action":"create","data":{...}}'
```

---

## Related Documentation

- [CUSTOM_FRONTEND_GUIDE.md](./CUSTOM_FRONTEND_GUIDE.md) - Building custom frontends
- [POSTMAN_API_TESTING.md](./POSTMAN_API_TESTING.md) - API testing guide
- [openapi.yaml](./openapi.yaml) - OpenAPI specification
- [SECURITY_SETUP.md](./SECURITY_SETUP.md) - Security configuration

---

## Interactive Documentation

Visit the interactive API documentation page:

```
https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec?page=docs
```

This page includes:
- ✅ Complete API reference
- ✅ Authentication examples
- ✅ Live endpoint testing
- ✅ Request/response samples

---

**Last Updated:** 2025-11-10
**Version:** 1.0.0
