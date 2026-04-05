/**
 * UEC System Reference Implementation
 *
 * Universal Event Code (UEC) v1.1 — the color-semantic QR standard
 * for ourSharedEvents. This JSX component is a deployable reference app
 * for showing sponsors and event organizers the complete UEC system.
 *
 * Usage: Drop into any React project, or use as a standalone reference.
 *
 * See docs/features/UEC-CODES.md for the full specification.
 */

import React, { useState } from 'react';

// ─── UEC Color Definitions ─────────────────────────────────────────────────────

const CORE_CODES = [
  {
    number: '01',
    name: 'ENTER',
    color: '#2D6A4F',
    label: 'Green',
    phase: 'Arrival',
    description: 'Venue entry, gate access, check-in',
    dataGenerated: 'form_registrations, checkin_counts',
    psychology: 'Go, safe, proceed — same meaning in every culture on Earth',
  },
  {
    number: '02',
    name: 'LIVE',
    color: '#E07A5F',
    label: 'Coral',
    phase: 'During',
    description: 'Real-time scoring, brackets, live feed',
    dataGenerated: 'scans, scan_aggregates',
    psychology: 'Excitement + warmth, no alarm — midpoint of red energy and orange inclusivity',
  },
  {
    number: '03',
    name: 'SPONSOR',
    color: '#1D3557',
    label: 'Blue',
    phase: 'During',
    description: 'Sponsor offers, brand activation, local deals',
    dataGenerated: 'sponsors, source_placement_id',
    psychology: 'Trust, institution, value — banks, hospitals, governments worldwide',
  },
  {
    number: '04',
    name: 'ARCHIVE',
    color: '#6C3483',
    label: 'Purple',
    phase: 'Post',
    description: 'Past results, SharedReport, memories',
    dataGenerated: 'scan_aggregates, form analytics',
    psychology: 'Permanence, memory, royalty — thousands of years across cultures',
  },
  {
    number: '05',
    name: 'HELP',
    color: '#D4668E',
    label: 'Pink',
    phase: 'Anytime',
    description: 'ADA assistance, first aid, accessibility',
    dataGenerated: 'Utility — no tracking',
    psychology: 'Care, assistance, compassion — healthcare and safety globally',
  },
  {
    number: '06',
    name: 'FEEDBACK',
    color: '#C4930A',
    label: 'Amber',
    phase: 'Post',
    description: 'Surveys, ratings, post-event voice',
    dataGenerated: 'form_surveys, email_signups',
    psychology: 'Reflection, warmth, completion — harvest and gold',
  },
  {
    number: '07',
    name: 'UTILITY',
    color: '#4A4A4A',
    label: 'Charcoal',
    phase: 'Anytime',
    description: 'WiFi, schedule, maps, general info',
    dataGenerated: 'Utility — minimal tracking',
    psychology: 'Infrastructure, backstage, utility — circuit breakers, server racks',
  },
];

const EXTENSION_CODES = [
  {
    name: 'ALERT',
    color: '#B8960A',
    label: 'Yellow',
    priority: 'HIGH',
    description: 'Safety notices, weather delays, venue emergencies',
  },
  {
    name: 'STAFF',
    color: '#A00020',
    label: 'Red',
    priority: 'HIGH',
    description: 'Staff-only pages, volunteer check-in, backstage access',
  },
  {
    name: 'CHECK-IN',
    color: '#006B6B',
    label: 'Teal',
    priority: 'MEDIUM',
    description: 'Attendance tracking, membership verification, roster',
  },
  {
    name: 'SHOP',
    color: '#1A4A48',
    label: 'Dark Teal',
    priority: 'MEDIUM',
    description: 'Merchandise, ticket upgrades, concessions, silent auction',
  },
];

const VERTICALS = [
  'Sports', 'School', 'Church', 'Museum', 'Rec Center',
  'Civic', 'Tourism', 'Bars', 'Government', 'Fundraising',
];

const CHANGELOG = [
  { from: 'Orange / GAME', to: 'Coral / LIVE', reason: 'Orange = caution/industrial. GAME too narrow for church/school.' },
  { from: 'Yellow / FEEDBACK', to: 'Amber / FEEDBACK', reason: 'Yellow fails QR contrast on white. Caution ≠ conversation.' },
  { from: 'White / UTILITY', to: 'Charcoal / UTILITY', reason: 'White on white = physically impossible to scan.' },
  { from: '(none)', to: 'Pink / HELP', reason: 'ADA, accessibility, human assistance gap filled.' },
];

// ─── Components ─────────────────────────────────────────────────────────────────

function CodeCard({ code, isExtension = false }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{
        border: `3px solid ${code.color}`,
        borderRadius: '12px',
        padding: '16px',
        marginBottom: '12px',
        cursor: 'pointer',
        backgroundColor: expanded ? `${code.color}11` : '#fff',
        transition: 'background-color 0.2s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '8px',
            backgroundColor: code.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 'bold',
            fontSize: '12px',
            flexShrink: 0,
          }}
        >
          {isExtension ? 'EXT' : code.number}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 'bold', fontSize: '18px' }}>
            {code.label} — {code.name}
          </div>
          <div style={{ color: '#666', fontSize: '14px' }}>
            {code.description}
          </div>
        </div>
        <div
          style={{
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: 'bold',
            backgroundColor: isExtension
              ? (code.priority === 'HIGH' ? '#fee' : '#efe')
              : '#f0f0f0',
            color: isExtension
              ? (code.priority === 'HIGH' ? '#a00' : '#060')
              : '#666',
          }}
        >
          {isExtension ? code.priority : code.phase}
        </div>
      </div>

      {expanded && !isExtension && (
        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #eee' }}>
          <div style={{ fontSize: '13px', color: '#444', marginBottom: '4px' }}>
            <strong>Data generated:</strong> {code.dataGenerated}
          </div>
          <div style={{ fontSize: '13px', color: '#444' }}>
            <strong>Color psychology:</strong> {code.psychology}
          </div>
        </div>
      )}
    </div>
  );
}

function AttendeeJourney() {
  const steps = [
    { code: 'GREEN', action: 'ENTER', desc: 'Arrives at venue. Scans green. No instructions needed.' },
    { code: 'BLUE', action: 'SPONSOR', desc: 'Sees a local offer on display. Scans blue. Gets a real discount.' },
    { code: 'CORAL', action: 'LIVE', desc: 'Event begins. Scans coral. Real-time action — all live.' },
    { code: 'PINK', action: 'HELP', desc: 'Needs accessible seating. Scans pink. Help arrives.' },
    { code: 'AMBER', action: 'FEEDBACK', desc: 'Event ends. Scans amber. 30 seconds. Feels heard.' },
    { code: 'PURPLE', action: 'ARCHIVE', desc: 'Goes home. Shares the purple link. The win lives forever.' },
  ];

  const codeColors = {
    GREEN: '#2D6A4F', BLUE: '#1D3557', CORAL: '#E07A5F',
    PINK: '#D4668E', AMBER: '#C4930A', PURPLE: '#6C3483',
  };

  return (
    <div style={{ marginTop: '24px' }}>
      <h3 style={{ marginBottom: '16px' }}>The Attendee Journey — One Event, Six Scans</h3>
      {steps.map((step, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '8px 0',
            borderLeft: `4px solid ${codeColors[step.code]}`,
            paddingLeft: '12px',
            marginBottom: '4px',
          }}
        >
          <div style={{
            fontWeight: 'bold',
            fontSize: '14px',
            color: codeColors[step.code],
            minWidth: '120px',
          }}>
            {i + 1}. {step.code} · {step.action}
          </div>
          <div style={{ fontSize: '14px', color: '#444' }}>{step.desc}</div>
        </div>
      ))}
    </div>
  );
}

function VerticalCoverage() {
  return (
    <div style={{ marginTop: '24px' }}>
      <h3 style={{ marginBottom: '16px' }}>Vertical Coverage</h3>
      <p style={{ fontSize: '14px', color: '#666', marginBottom: '12px' }}>
        Every core code works across all verticals — no vertical requires a different system.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd' }}>
              <th style={{ textAlign: 'left', padding: '8px' }}>Vertical</th>
              <th style={{ padding: '8px' }}>7 Core</th>
              <th style={{ padding: '8px' }}>ALERT</th>
              <th style={{ padding: '8px' }}>STAFF</th>
              <th style={{ padding: '8px' }}>CHECK-IN</th>
              <th style={{ padding: '8px' }}>SHOP</th>
            </tr>
          </thead>
          <tbody>
            {VERTICALS.map((v) => {
              const hasStaff = !['Tourism', 'Bars'].includes(v);
              const hasCheckin = !['Tourism', 'Bars', 'Government', 'Fundraising'].includes(v);
              const hasShop = ['Sports', 'Museum', 'Tourism', 'Bars', 'Fundraising'].includes(v);
              return (
                <tr key={v} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '8px', fontWeight: '500' }}>{v}</td>
                  <td style={{ padding: '8px', textAlign: 'center', color: '#2D6A4F' }}>✓</td>
                  <td style={{ padding: '8px', textAlign: 'center', color: '#B8960A' }}>✓</td>
                  <td style={{ padding: '8px', textAlign: 'center', color: hasStaff ? '#A00020' : '#ccc' }}>
                    {hasStaff ? '✓' : '—'}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'center', color: hasCheckin ? '#006B6B' : '#ccc' }}>
                    {hasCheckin ? '✓' : '—'}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'center', color: hasShop ? '#1A4A48' : '#ccc' }}>
                    {hasShop ? '✓' : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Changelog() {
  return (
    <div style={{ marginTop: '24px' }}>
      <h3 style={{ marginBottom: '16px' }}>Changes from v1.0 → v1.1</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ddd' }}>
            <th style={{ textAlign: 'left', padding: '8px' }}>v1.0</th>
            <th style={{ textAlign: 'left', padding: '8px' }}>v1.1</th>
            <th style={{ textAlign: 'left', padding: '8px' }}>Reason</th>
          </tr>
        </thead>
        <tbody>
          {CHANGELOG.map((c, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '8px', color: '#999', textDecoration: 'line-through' }}>{c.from}</td>
              <td style={{ padding: '8px', fontWeight: '500' }}>{c.to}</td>
              <td style={{ padding: '8px', color: '#666' }}>{c.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function UECSystem() {
  const [activeTab, setActiveTab] = useState('codes');

  const tabs = [
    { id: 'codes', label: 'Color Codes' },
    { id: 'journey', label: 'Attendee Journey' },
    { id: 'verticals', label: 'Verticals' },
    { id: 'changelog', label: 'v1.0 → v1.1' },
  ];

  return (
    <div style={{
      maxWidth: '800px',
      margin: '0 auto',
      padding: '24px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '28px', color: '#1a1a2e' }}>
          Universal Event Code (UEC) v1.1
        </h1>
        <p style={{ color: '#666', fontSize: '16px', marginTop: '8px' }}>
          7 colors. One meaning each. No instructions required.
        </p>
      </div>

      {/* Tab Navigation */}
      <div style={{
        display: 'flex',
        gap: '4px',
        marginBottom: '24px',
        borderBottom: '2px solid #eee',
        paddingBottom: '0',
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 16px',
              border: 'none',
              background: activeTab === tab.id ? '#1a1a2e' : 'transparent',
              color: activeTab === tab.id ? '#fff' : '#666',
              borderRadius: '8px 8px 0 0',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: activeTab === tab.id ? 'bold' : 'normal',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'codes' && (
        <div>
          <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>7 Core Codes</h2>
          {CORE_CODES.map((code) => (
            <CodeCard key={code.number} code={code} />
          ))}

          <h2 style={{ fontSize: '20px', marginTop: '32px', marginBottom: '16px' }}>
            4 Extension Codes
          </h2>
          {EXTENSION_CODES.map((code) => (
            <CodeCard key={code.name} code={code} isExtension />
          ))}
        </div>
      )}

      {activeTab === 'journey' && <AttendeeJourney />}
      {activeTab === 'verticals' && <VerticalCoverage />}
      {activeTab === 'changelog' && <Changelog />}

      {/* Footer */}
      <div style={{
        marginTop: '32px',
        paddingTop: '16px',
        borderTop: '1px solid #eee',
        fontSize: '13px',
        color: '#999',
      }}>
        <p>
          <strong>ourSharedEvents</strong> — Universal Event Code v1.1
          <br />
          The color IS the instruction. An attendee sees green and knows it's entry.
          Sees blue and knows it's a sponsor. No training, no legend, no explanation needed.
        </p>
        <p>
          See <code>docs/features/UEC-CODES.md</code> for the full specification.
        </p>
      </div>
    </div>
  );
}
