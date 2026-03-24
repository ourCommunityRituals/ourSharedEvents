# Building Custom Frontends with MVP Event Toolkit

## 🎯 Overview

The MVP Event Toolkit now supports **BOTH** architectures:

1. **Built-in HTML Pages** - Use `google.script.run` (current Admin/Public/Display pages)
2. **REST API** - Build custom frontends in React, Vue, Angular, mobile apps, etc.

This gives you maximum flexibility to build the UI that fits your needs!

---

## 📦 Built-in Shared Libraries (For Apps Script HTML Pages)

When building **within the Apps Script HTML Service** (Admin.html, Sponsor.html, etc.), use these shared libraries:

### SharedUtils.html

Common utility functions for all pages:

```html
<!-- Include in your page -->
<?!= include('SharedUtils'); ?>
```

```javascript
// Alert notifications (auto-dismissing)
SharedUtils.showAlert('Event created!', 'success');
SharedUtils.showAlert('Invalid input', 'error');
SharedUtils.showAlert('Loading...', 'info');

// Date formatting
SharedUtils.formatDate('2025-12-25');           // "Dec 25, 2025"
SharedUtils.formatRelativeTime(new Date());     // "just now", "2 hours ago"

// Validation
SharedUtils.isValidEmail('user@example.com');   // true
SharedUtils.isValidUrl('https://site.com');     // true
SharedUtils.validateForm(formEl, { name: 'required', email: 'email' });

// XSS prevention (delegates to NU.esc)
SharedUtils.esc('<script>alert("xss")</script>'); // Escaped safely

// Debounce/throttle
const debouncedSearch = SharedUtils.debounce(searchFn, 300);
const throttledScroll = SharedUtils.throttle(scrollFn, 100);
```

### APIClient.html

Standardized CRUD operations wrapping `NU.rpc`:

```html
<!-- Include in your page (requires NUSDK.html) -->
<?!= include('NUSDK'); ?>
<?!= include('APIClient'); ?>
```

```javascript
// Initialize once
APIClient.init({
  brandId: 'root',
  adminKey: sessionStorage.getItem('adminKey'),
  onError: (err) => SharedUtils.showAlert(err.message, 'error')
});

// CRUD operations
const sponsors = await APIClient.list('sponsors');
const event = await APIClient.get('events', 'evt_123');
const created = await APIClient.create('sponsors', { name: 'Acme', tier: 'gold' });
await APIClient.update('sponsors', 'spn_123', { tier: 'platinum' });
await APIClient.remove('sponsors', 'spn_123');

// Specialized methods
const bundle = await APIClient.getPublicBundle('evt_123');
const analytics = await APIClient.getSponsorAnalytics('spn_123');
```

### Styles.html (Shared CSS Classes)

Include `Styles.html` for consistent UI components:

```html
<?!= include('Styles'); ?>
```

| Class | Description |
|-------|-------------|
| `.page-section` | White card container with shadow |
| `.page-header-card` | Header section with navigation |
| `.entity-grid` | Responsive grid for cards |
| `.entity-card` | Individual entity card |
| `.alert`, `.alert-success`, `.alert-error` | Notification alerts |
| `.tier-badge`, `.tier-gold`, `.tier-platinum` | Sponsorship tier badges |
| `.analytics-grid`, `.analytics-card` | Analytics dashboard layout |
| `.loading-state`, `.empty-state` | Loading/empty placeholders |

---

## 🚀 Quick Start

### 1. Get Your API URL

After deploying your Apps Script:

```
https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec
```

### 2. Test the API

```bash
# Health check
curl "https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec?action=status"

# List events
curl "https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec?action=list&brand=root&scope=events"
```

### 3. Build Your Frontend!

See examples below for React, Vue, vanilla JavaScript, and mobile apps.

---

## 📋 API Reference

### Public Endpoints (No Auth Required)

#### GET Status
```
GET {BASE_URL}?action=status
```
Response:
```json
{
  "ok": true,
  "value": {
    "build": "mvp-v1.0-events-only",
    "contract": "v1",
    "dbOk": true,
    "brand": "root"
  }
}
```

#### GET Configuration
```
GET {BASE_URL}?action=config&brand=root&scope=events
```

#### GET List Events
```
GET {BASE_URL}?action=list&brand=root&scope=events&etag=abc123
```
Response:
```json
{
  "ok": true,
  "value": {
    "items": [
      {
        "id": "evt_123",
        "data": {
          "eventName": "Summer Concert",
          "eventDate": "2025-07-15",
          "eventTime": "19:00"
        },
        "publicUrl": "https://script.google.com/.../exec?...",
        "posterUrl": "https://script.google.com/.../exec?...",
        "displayUrl": "https://script.google.com/.../exec?..."
      }
    ],
    "etag": "xyz789"
  }
}
```

#### GET Single Event
```
GET {BASE_URL}?action=get&brand=root&scope=events&id=evt_123
```

---

### Admin Endpoints (Require Auth)

All admin operations use **POST** with JSON body containing `adminKey`.

#### POST Create Event
```bash
curl -X POST "{BASE_URL}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "brandId": "root",
    "adminKey": "YOUR_ADMIN_SECRET",
    "scope": "events",
    "templateId": "Event",
    "data": {
      "eventName": "Summer Concert Series",
      "eventDate": "2025-07-15",
      "eventTime": "19:00",
      "locationName": "Central Park"
    }
  }'
```

#### POST Update Event
```bash
curl -X POST "{BASE_URL}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "update",
    "brandId": "root",
    "adminKey": "YOUR_ADMIN_SECRET",
    "scope": "events",
    "id": "evt_123",
    "data": {
      "eventName": "Updated Event Name"
    }
  }'
```

#### POST Get Analytics Report
```bash
curl -X POST "{BASE_URL}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "getReport",
    "brandId": "root",
    "adminKey": "YOUR_ADMIN_SECRET",
    "eventId": "evt_123",
    "startDate": "2025-01-01",
    "endDate": "2025-12-31"
  }'
```

---

## 💻 React Example

### Setup API Client

```javascript
// src/api/eventApi.js
const BASE_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
const ADMIN_KEY = process.env.REACT_APP_ADMIN_KEY;

class EventApi {
  // Public endpoints
  async getStatus() {
    const res = await fetch(`${BASE_URL}?action=status`);
    return res.json();
  }

  async listEvents(brand = 'root', scope = 'events', etag = '') {
    const params = new URLSearchParams({ action: 'list', brand, scope });
    if (etag) params.append('etag', etag);

    const res = await fetch(`${BASE_URL}?${params}`);
    return res.json();
  }

  async getEvent(id, brand = 'root', scope = 'events') {
    const params = new URLSearchParams({ action: 'get', brand, scope, id });
    const res = await fetch(`${BASE_URL}?${params}`);
    return res.json();
  }

  // Admin endpoints
  async createEvent(data) {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        brandId: 'root',
        adminKey: ADMIN_KEY,
        scope: 'events',
        templateId: 'Event',
        data
      })
    });
    return res.json();
  }

  async updateEvent(id, data) {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        brandId: 'root',
        adminKey: ADMIN_KEY,
        scope: 'events',
        id,
        data
      })
    });
    return res.json();
  }

  async getReport(eventId, startDate, endDate) {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'getReport',
        brandId: 'root',
        adminKey: ADMIN_KEY,
        eventId,
        startDate,
        endDate
      })
    });
    return res.json();
  }

  async logEvent(eventId, surface, metric, sponsorId = '', value = 1) {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'logEvents',
        items: [{
          eventId,
          surface,
          metric,
          sponsorId,
          value,
          token: ''
        }]
      })
    });
    return res.json();
  }
}

export default new EventApi();
```

### React Component

```jsx
// src/components/EventList.jsx
import React, { useState, useEffect } from 'react';
import eventApi from '../api/eventApi';

function EventList() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    try {
      setLoading(true);
      const result = await eventApi.listEvents();

      if (result.ok) {
        setEvents(result.value.items);
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading events...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="event-list">
      <h1>Events</h1>
      {events.map(event => (
        <div key={event.id} className="event-card">
          <h2>{event.data.eventName}</h2>
          <p>📅 {event.data.eventDate} at {event.data.eventTime}</p>
          <p>📍 {event.data.locationName}</p>
          <a href={event.publicUrl} target="_blank" rel="noopener noreferrer">
            View Event →
          </a>
        </div>
      ))}
    </div>
  );
}

export default EventList;
```

### Create Event Form

```jsx
// src/components/CreateEventForm.jsx
import React, { useState } from 'react';
import eventApi from '../api/eventApi';

function CreateEventForm() {
  const [formData, setFormData] = useState({
    eventName: '',
    eventDate: '',
    eventTime: '',
    locationName: '',
    locationCity: '',
    description: ''
  });
  const [status, setStatus] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('Creating...');

    const result = await eventApi.createEvent(formData);

    if (result.ok) {
      setStatus('✅ Event created!');
      console.log('New event:', result.value);
      // Reset form
      setFormData({
        eventName: '',
        eventDate: '',
        eventTime: '',
        locationName: '',
        locationCity: '',
        description: ''
      });
    } else {
      setStatus(`❌ Error: ${result.message}`);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Create Event</h2>

      <input
        type="text"
        placeholder="Event Name"
        value={formData.eventName}
        onChange={e => setFormData({...formData, eventName: e.target.value})}
        required
      />

      <input
        type="date"
        value={formData.eventDate}
        onChange={e => setFormData({...formData, eventDate: e.target.value})}
        required
      />

      <input
        type="time"
        value={formData.eventTime}
        onChange={e => setFormData({...formData, eventTime: e.target.value})}
        required
      />

      <input
        type="text"
        placeholder="Location"
        value={formData.locationName}
        onChange={e => setFormData({...formData, locationName: e.target.value})}
        required
      />

      <textarea
        placeholder="Description"
        value={formData.description}
        onChange={e => setFormData({...formData, description: e.target.value})}
      />

      <button type="submit">Create Event</button>
      {status && <p>{status}</p>}
    </form>
  );
}

export default CreateEventForm;
```

---

## 🎨 Vue.js Example

### API Service

```javascript
// src/services/eventService.js
import axios from 'axios';

const BASE_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
const ADMIN_KEY = process.env.VUE_APP_ADMIN_KEY;

export default {
  async listEvents(brand = 'root', scope = 'events') {
    const { data } = await axios.get(BASE_URL, {
      params: { action: 'list', brand, scope }
    });
    return data;
  },

  async getEvent(id, brand = 'root', scope = 'events') {
    const { data } = await axios.get(BASE_URL, {
      params: { action: 'get', brand, scope, id }
    });
    return data;
  },

  async createEvent(eventData) {
    const { data } = await axios.post(BASE_URL, {
      action: 'create',
      brandId: 'root',
      adminKey: ADMIN_KEY,
      scope: 'events',
      templateId: 'Event',
      data: eventData
    });
    return data;
  },

  async updateEvent(id, eventData) {
    const { data } = await axios.post(BASE_URL, {
      action: 'update',
      brandId: 'root',
      adminKey: ADMIN_KEY,
      scope: 'events',
      id,
      data: eventData
    });
    return data;
  }
};
```

### Vue Component

```vue
<!-- src/components/EventList.vue -->
<template>
  <div class="event-list">
    <h1>Events</h1>

    <div v-if="loading">Loading...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <div v-else class="events">
      <div v-for="event in events" :key="event.id" class="event-card">
        <h2>{{ event.data.eventName }}</h2>
        <p>📅 {{ event.data.eventDate }} at {{ event.data.eventTime }}</p>
        <p>📍 {{ event.data.locationName }}</p>
        <a :href="event.publicUrl" target="_blank">View Event →</a>
      </div>
    </div>
  </div>
</template>

<script>
import eventService from '@/services/eventService';

export default {
  name: 'EventList',
  data() {
    return {
      events: [],
      loading: true,
      error: null
    };
  },
  async mounted() {
    await this.loadEvents();
  },
  methods: {
    async loadEvents() {
      try {
        this.loading = true;
        const result = await eventService.listEvents();

        if (result.ok) {
          this.events = result.value.items;
        } else {
          this.error = result.message;
        }
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    }
  }
};
</script>

<style scoped>
.event-card {
  border: 1px solid #ddd;
  padding: 1rem;
  margin: 1rem 0;
  border-radius: 8px;
}
</style>
```

---

## 📱 Mobile App Example (React Native)

```javascript
// src/api/eventApi.js
const BASE_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';

export const listEvents = async () => {
  const response = await fetch(`${BASE_URL}?action=list&brand=root&scope=events`);
  return response.json();
};

export const createEvent = async (eventData, adminKey) => {
  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      brandId: 'root',
      adminKey,
      scope: 'events',
      templateId: 'Event',
      data: eventData
    })
  });
  return response.json();
};

// EventListScreen.js
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { listEvents } from '../api/eventApi';

export default function EventListScreen() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    try {
      const result = await listEvents();
      if (result.ok) {
        setEvents(result.value.items);
      }
    } catch (error) {
      console.error('Error loading events:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <ActivityIndicator size="large" />;
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={events}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.title}>{item.data.eventName}</Text>
            <Text>📅 {item.data.eventDate} at {item.data.eventTime}</Text>
            <Text>📍 {item.data.locationName}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  card: {
    backgroundColor: 'white',
    padding: 16,
    marginBottom: 12,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2
  },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 }
});
```

---

## 🌐 Vanilla JavaScript Example

```html
<!DOCTYPE html>
<html>
<head>
  <title>Event Viewer</title>
</head>
<body>
  <h1>Upcoming Events</h1>
  <div id="events"></div>

  <script>
    const BASE_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';

    async function loadEvents() {
      try {
        const response = await fetch(`${BASE_URL}?action=list&brand=root&scope=events`);
        const result = await response.json();

        if (result.ok) {
          displayEvents(result.value.items);
        } else {
          document.getElementById('events').innerHTML = `<p>Error: ${result.message}</p>`;
        }
      } catch (error) {
        console.error('Error:', error);
      }
    }

    function displayEvents(events) {
      const html = events.map(event => `
        <div class="event-card">
          <h2>${event.data.eventName}</h2>
          <p>📅 ${event.data.eventDate} at ${event.data.eventTime}</p>
          <p>📍 ${event.data.locationName}</p>
          <a href="${event.publicUrl}" target="_blank">View Event →</a>
        </div>
      `).join('');

      document.getElementById('events').innerHTML = html;
    }

    // Load events on page load
    loadEvents();
  </script>

  <style>
    .event-card {
      border: 1px solid #ddd;
      padding: 1rem;
      margin: 1rem 0;
      border-radius: 8px;
    }
  </style>
</body>
</html>
```

---

## 🔐 Security Best Practices

### 1. Never Expose Admin Keys in Frontend Code

❌ **Bad:**
```javascript
const ADMIN_KEY = 'my-secret-key'; // Don't do this!
```

✅ **Good:**
```javascript
// Use environment variables
const ADMIN_KEY = process.env.REACT_APP_ADMIN_KEY;

// Or prompt user to login
const ADMIN_KEY = await authenticateUser();
```

### 2. Use HTTPS Only

Always use `https://` URLs, never `http://`.

### 3. Validate Responses

```javascript
const result = await eventApi.listEvents();
if (!result.ok) {
  // Handle error
  console.error('API Error:', result.code, result.message);
  return;
}
// Use result.value
```

### 4. Rate Limiting

The API has built-in rate limiting (20 requests/minute per brand). Handle rate limit errors gracefully:

```javascript
if (result.code === 'RATE_LIMITED') {
  alert('Too many requests. Please wait a moment.');
}
```

---

## 📊 Analytics Integration

Track user interactions in your custom frontend:

```javascript
// Track page views
await eventApi.logEvent('evt_123', 'custom-app', 'view');

// Track sponsor clicks
await eventApi.logEvent('evt_123', 'custom-app', 'click', 'SPONSOR_1');

// Track dwell time
await eventApi.logEvent('evt_123', 'custom-app', 'dwell', '', 45); // 45 seconds
```

---

## 🧪 Testing Your Integration

### 1. Test with Postman

Import the Postman collection: `postman-collection.json`

### 2. Test with curl

```bash
# List events
curl "https://script.google.com/.../exec?action=list&brand=root&scope=events"

# Create event
curl -X POST "https://script.google.com/.../exec" \
  -H "Content-Type: application/json" \
  -d '{"action":"create","brandId":"root","adminKey":"YOUR_KEY","scope":"events","templateId":"Event","data":{"eventName":"Test Event","eventDate":"2025-07-15"}}'
```

### 3. Use Browser DevTools

Open your custom app → F12 → Network tab → See all API requests

---

## 📖 Next Steps

1. **Deploy your backend** - See [DEPLOYMENT.md](./DEPLOYMENT.md)
2. **Import Postman collection** - See [postman-collection.json](./postman-collection.json)
3. **Read API documentation** - See [POSTMAN_API_TESTING.md](./POSTMAN_API_TESTING.md)
4. **Build your frontend!** - Use examples above

---

## 💡 Architecture Benefits

### Dual Interface Support

```
┌─────────────────────────┐
│   Your Custom Frontend  │
│   (React/Vue/Mobile)    │
└───────────┬─────────────┘
            │
            │ REST API (GET/POST)
            ▼
┌─────────────────────────┐
│   Apps Script Backend   │
│   (Code.gs)             │
└───────────┬─────────────┘
            │
            │ google.script.run
            ▼
┌─────────────────────────┐
│   Built-in HTML Pages   │
│   (Admin/Public/Display)│
└─────────────────────────┘
```

**Both work simultaneously!** You can:
- Use built-in pages for quick admin work
- Build custom mobile app for end users
- Create React dashboard for analytics
- All using the same backend

---

## 🆘 Support

- **Testing:** See [TESTING.md](./TESTING.md)
- **Deployment:** See [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Design System:** See [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)

---

**Happy building!** 🚀
