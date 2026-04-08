# Live Running Map System

## Overview

This project enables real-time sharing of thoughts and status during a run using voice notes mapped to GPS coordinates. The system is optimized for low cognitive load during movement and minimal battery usage, while providing near real-time visualization for observers.

---

## Motivation

During long runs (e.g., ultra training or border crossings), capturing thoughts, physical state, and situational context is valuable but traditionally costly in time and energy.

Previous approaches:

- Paper + pen → impractical during movement
- Mobile notes / Excel → too slow and cognitively demanding

Goal:

- Capture structured or free-form notes **hands-free and fast**
- Automatically associate notes with **GPS position and time**
- Share **live map with context** to friends/family
- Work reliably even with **poor connectivity**

---

## High-Level Architecture

```
Voice Input (Android)
        ↓
MacroDroid (automation)
        ↓
GPS + Timestamp
        ↓
HTTP POST (JSON)
        ↓
Google Apps Script (Webhook)
        ↓
Google Sheets (storage)
        ↓
GitHub Pages (Leaflet web app)
        ↓
Live Map (for observers)
```

---

## Components

### 1. Mobile Layer (Data Capture)

**Device:** Android (Pixel 6a)
**Tool:** MacroDroid

#### Responsibilities:

- Capture voice input → convert to text
- Fetch current GPS location
- Generate timestamp
- Send structured data via HTTP POST

#### Data format:

```json
{
  "time": "2026-04-08 14:53:00",
  "lat": 49.7892,
  "lon": 18.27,
  "note": "krize ale držím tempo"
}
```

#### Trigger:

- Widget button on home screen
- Single tap → speak → done

#### Design decisions:

- Use **last known location** for speed and battery efficiency
- Avoid continuous GPS tracking (handled by Garmin)

---

### 2. Transport Layer

**Protocol:** HTTP POST

MacroDroid sends JSON payload to a webhook endpoint.

---

### 3. Backend (Webhook)

**Platform:** Google Apps Script

#### Functions:

- `doPost(e)` → receives data and writes to sheet
- `doGet()` → exposes data as JSON for frontend

#### Behavior:

- Stateless
- Append-only storage

---

### 4. Data Storage

**Platform:** Google Sheets

#### Structure:

| time | lat | lon | note |
| ---- | --- | --- | ---- |

#### Characteristics:

- Simple
- Transparent
- Easily debuggable

---

### 5. Frontend (Live Map)

**Hosting:** GitHub Pages
**Library:** Leaflet.js

#### Features:

- Displays GPX route
- Displays note markers
- Auto-refresh every 30 seconds
- Popup with note + timestamp

#### Data source:

- JSON from Apps Script (`doGet`)

---

### 6. Map Rendering

#### GPX Layer:

- Loaded via `leaflet-gpx`
- Defines planned route

#### Notes Layer:

- Markers from Google Sheets
- Re-rendered on refresh

---

## Current Features

### Core

- Voice → text note capture
- GPS tagging
- Automatic upload to cloud
- Live map visualization

### UX

- One-tap interaction during run
- No typing required
- Minimal interruption

### Sharing

- Public URL (GitHub Pages)
- Observers can:
  - See route
  - See notes in context

---

## System Properties

### Latency

- Typically near real-time (seconds)
- Depends on network availability

### Offline Behavior (current state)

- Not fully implemented yet
- Notes may fail if no signal

### Battery Optimization

- No continuous GPS
- Event-based location fetch
- Compatible with battery saver mode

---

## Known Limitations

- No automatic retry (offline buffer missing)
- No deduplication of notes
- No authentication (public endpoint)
- Google Sheets not optimized for large scale
- No “current position” indicator yet

---

## Planned Improvements

### High Priority

1. **Offline buffer + retry mechanism**
2. **Current position highlighting**
3. **GPX-based kilometer matching (auto KM)**

### Medium Priority

4. Improved map UX (icons, clustering, filtering)
5. Note categorization (energy, pain, etc.)
6. Timestamp normalization

### Advanced

7. Replace Google Sheets with database (Supabase/Firebase)
8. Real-time streaming instead of polling
9. Mobile UI for note history

---

## Design Principles

- **Minimal friction during activity**
- **Robustness over elegance**
- **Observable system (easy debugging)**
- **Modular components (replaceable parts)**

---

## Usage Flow

1. Runner taps widget
2. Speaks note
3. System captures:
   - text
   - GPS
   - time

4. Data sent to backend
5. Stored in Google Sheets
6. Map refreshes
7. Observers see update

---

## For Future Development (AI Agents)

Key extension points:

- **Mobile layer** → replace MacroDroid with native app
- **Backend** → migrate to scalable API
- **Data model** → enrich with metrics
- **Frontend** → add timeline / playback

Critical invariants:

- Must remain usable during running
- Must tolerate poor connectivity
- Must remain low battery impact

---

## Repository Structure

```
/
├── index.html        # Leaflet map
├── trasa.gpx         # Planned route
└── README.md         # This file
```

---

## Summary

This system converts real-world movement and subjective experience into a live, spatial narrative. It prioritizes simplicity and reliability while enabling meaningful real-time sharing.
