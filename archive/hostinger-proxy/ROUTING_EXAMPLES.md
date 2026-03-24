# zeventbooks.com - User-Friendly URL Routing Guide

**Last Updated:** 2025-11-16
**Purpose:** Non-technical friendly URL patterns for event management

---

## Admin Pages (Event Organizers)

### Main Admin
```
https://zeventbooks.com/admin
https://zeventbooks.com/admin?brand=abc
```

### Common Admin Subpages
```
https://zeventbooks.com/admin/my-events          # View all your events
https://zeventbooks.com/admin/create-event       # Create new event
https://zeventbooks.com/admin/team-roster        # Manage teams
https://zeventbooks.com/admin/player-list        # Manage players
https://zeventbooks.com/admin/schedule           # Edit schedule
https://zeventbooks.com/admin/results            # Enter scores/results
https://zeventbooks.com/admin/sponsors           # Manage sponsors
https://zeventbooks.com/admin/settings           # Account settings
https://zeventbooks.com/admin/help               # Help & support
```

---

## Display Pages (TV/Kiosk Mode)

### Event Display - Main View
```
https://zeventbooks.com/fall-league-display
https://zeventbooks.com/display/fall-league
```

### Display Subpages (What to Show on TV)
```
https://zeventbooks.com/fall-league-display/scoreboard        # Live scores
https://zeventbooks.com/fall-league-display/schedule          # Today's games
https://zeventbooks.com/fall-league-display/standings         # League standings
https://zeventbooks.com/fall-league-display/bracket           # Tournament bracket
https://zeventbooks.com/fall-league-display/team-photos       # Team pictures
https://zeventbooks.com/fall-league-display/sponsors          # Sponsor slideshow
https://zeventbooks.com/fall-league-display/announcements     # Important messages
https://zeventbooks.com/fall-league-display/highlights        # Top plays/moments

# Alternative prefix style:
https://zeventbooks.com/display/fall-league/scoreboard
https://zeventbooks.com/display/fall-league/standings
```

---

## Poster Pages (Printable/Shareable)

### Event Poster - Main View
```
https://zeventbooks.com/fall-league-poster
https://zeventbooks.com/poster/fall-league
```

### Poster Subpages (Different Views)
```
https://zeventbooks.com/fall-league-poster/view              # Preview before printing
https://zeventbooks.com/fall-league-poster/download          # Download PDF
https://zeventbooks.com/fall-league-poster/share             # Share on social media
https://zeventbooks.com/fall-league-poster/print-friendly    # Printer-optimized view
https://zeventbooks.com/fall-league-poster/with-qr-code      # Include QR code for signup
https://zeventbooks.com/fall-league-poster/flyer             # Compact flyer version
https://zeventbooks.com/fall-league-poster/instagram         # Instagram-sized image

# Alternative prefix style:
https://zeventbooks.com/poster/fall-league/view
https://zeventbooks.com/poster/fall-league/download
```

---

## Signup Forms (Player Registration)

### Event Signup - Main Form
```
https://zeventbooks.com/fall-league-signup
https://zeventbooks.com/fall-league-register      # Alternative name
https://zeventbooks.com/signup/fall-league
https://zeventbooks.com/register/fall-league
```

### Signup Subpages (Multi-Step Registration)
```
https://zeventbooks.com/fall-league-signup/player-info       # Step 1: Basic info
https://zeventbooks.com/fall-league-signup/team-selection    # Step 2: Pick team
https://zeventbooks.com/fall-league-signup/payment           # Step 3: Pay fees
https://zeventbooks.com/fall-league-signup/waiver            # Step 4: Sign waiver
https://zeventbooks.com/fall-league-signup/confirmation      # Step 5: Review & confirm
https://zeventbooks.com/fall-league-signup/thank-you         # Final: Thank you page
https://zeventbooks.com/fall-league-signup/receipt           # View payment receipt
https://zeventbooks.com/fall-league-signup/edit              # Edit registration
https://zeventbooks.com/fall-league-signup/cancel            # Cancel registration

# Alternative prefix style:
https://zeventbooks.com/signup/fall-league/player-info
https://zeventbooks.com/signup/fall-league/payment
https://zeventbooks.com/signup/fall-league/thank-you
```

---

## Public Event Pages (Anyone Can View)

### Event Information
```
https://zeventbooks.com/fall-league-2024           # Main event page
https://zeventbooks.com/events/fall-league-2024    # Alternative
https://zeventbooks.com/fall-league-info           # Info suffix
```

### Public Subpages (No subpages yet, but could add)
```
https://zeventbooks.com/fall-league-2024/details
https://zeventbooks.com/fall-league-2024/location
https://zeventbooks.com/fall-league-2024/rules
https://zeventbooks.com/fall-league-2024/teams
https://zeventbooks.com/fall-league-2024/photos
```

---

## System/Utility Pages

### Health & Status
```
https://zeventbooks.com/health                     # API health check
https://zeventbooks.com/status                     # System status
https://zeventbooks.com/test                       # Test page
```

---

## Complete Real-World Examples

### Example 1: Fall Bocce League 2024

**For Event Organizer (Admin):**
```
https://zeventbooks.com/admin?brand=abc
https://zeventbooks.com/admin/my-events?brand=abc
https://zeventbooks.com/admin/team-roster?brand=abc&event=fall-league-2024
https://zeventbooks.com/admin/results?brand=abc&event=fall-league-2024
```

**For TV Display at Venue:**
```
https://zeventbooks.com/fall-league-2024-display/scoreboard
https://zeventbooks.com/fall-league-2024-display/schedule
https://zeventbooks.com/fall-league-2024-display/standings
```

**For Promotional Poster:**
```
https://zeventbooks.com/fall-league-2024-poster/view
https://zeventbooks.com/fall-league-2024-poster/download
https://zeventbooks.com/fall-league-2024-poster/share
```

**For Player Signup:**
```
https://zeventbooks.com/fall-league-2024-signup
https://zeventbooks.com/fall-league-2024-signup/player-info
https://zeventbooks.com/fall-league-2024-signup/team-selection
https://zeventbooks.com/fall-league-2024-signup/payment
https://zeventbooks.com/fall-league-2024-signup/thank-you
```

**For Public Viewing:**
```
https://zeventbooks.com/fall-league-2024
https://zeventbooks.com/events/fall-league-2024
```

---

### Example 2: Championship Tournament

**TV Display:**
```
https://zeventbooks.com/championship-display/bracket
https://zeventbooks.com/championship-display/scoreboard
https://zeventbooks.com/championship-display/team-photos
```

**Poster:**
```
https://zeventbooks.com/championship-poster/with-qr-code
https://zeventbooks.com/championship-poster/instagram
```

**Signup:**
```
https://zeventbooks.com/championship-signup/player-info
https://zeventbooks.com/championship-signup/waiver
https://zeventbooks.com/championship-signup/confirmation
```

---

### Example 3: Multi-brand Support

**American Bocce Co. (ABC):**
```
https://zeventbooks.com/admin?brand=abc
https://zeventbooks.com/summer-league-display/scoreboard?brand=abc
```

**Chicago Bocce Club (CBC):**
```
https://zeventbooks.com/admin?brand=cbc
https://zeventbooks.com/weekly-tournament-display/bracket?brand=cbc
```

**Chicago Bocce League (CBL):**
```
https://zeventbooks.com/admin?brand=cbl
https://zeventbooks.com/city-championship-poster/download?brand=cbl
```

---

## URL Patterns Summary

### Suffix Pattern (Recommended)
```
/{event-slug}-display/{subpage}
/{event-slug}-poster/{subpage}
/{event-slug}-signup/{subpage}
/{event-slug}-info
```

### Prefix Pattern (Alternative)
```
/display/{event-slug}/{subpage}
/poster/{event-slug}/{subpage}
/signup/{event-slug}/{subpage}
/events/{event-slug}
```

### Query Parameter Pattern (For Admin & Brands)
```
/admin?brand={brand-id}
/admin/{subpage}?brand={brand-id}
?p=admin&brand={brand-id}
```

---

## User-Friendly Subpage Naming Guidelines

### ✅ DO Use These Words:
- **my-events** (not "event-list")
- **scoreboard** (not "scores-view")
- **schedule** (not "game-times")
- **standings** (not "rankings-table")
- **thank-you** (not "confirmation")
- **player-info** (not "user-details")
- **team-selection** (not "pick-team")
- **download** (not "export-pdf")
- **share** (not "social-share")

### ❌ AVOID Technical Terms:
- ~~settings~~ → Use "preferences" or "account"
- ~~config~~ → Use "setup"
- ~~api~~ → Use specific feature names
- ~~webhook~~ → Don't expose to users
- ~~callback~~ → Don't expose to users

### 🎯 Use Action Words:
- **create-event** (clear action)
- **edit-team** (clear action)
- **view-results** (clear action)
- **download-poster** (clear action)

---

## Mobile-Friendly Short URLs

For texting/social media, use shorter versions:

```
# Instead of:
https://zeventbooks.com/fall-league-2024-signup/player-info

# Use shortlink (if configured):
https://zeventbooks.com/r?t=abc123

# Or shorter event slugs:
https://zeventbooks.com/fl24-signup
https://zeventbooks.com/fl24-display/scores
```

---

## SEO-Friendly URLs

Use descriptive event slugs with location/date:

```
# Good (descriptive):
https://zeventbooks.com/chicago-fall-bocce-league-2024
https://zeventbooks.com/lincoln-park-tournament-june-2024

# Avoid (too generic):
https://zeventbooks.com/event-123
https://zeventbooks.com/e1
```

---

## Testing URLs (Before Going Live)

Enable debug mode to test routing:

1. Edit `index.php` on Hostinger
2. Set `$debugMode = true;` (line 23)
3. Visit any URL to see routing details
4. Set back to `false` when done

**Debug mode shows:**
- What route matched
- Event slug extracted
- Subpage detected
- Final target URL

---

## Quick Reference Card

**For Event Organizers:**
| Task | URL |
|------|-----|
| Manage events | `/admin/my-events` |
| Create event | `/admin/create-event` |
| Enter scores | `/admin/results` |
| Manage teams | `/admin/team-roster` |

**For Venue TV Display:**
| Show | URL |
|------|-----|
| Live scores | `/{event}-display/scoreboard` |
| Schedule | `/{event}-display/schedule` |
| Standings | `/{event}-display/standings` |
| Bracket | `/{event}-display/bracket` |

**For Marketing:**
| Need | URL |
|------|-----|
| View poster | `/{event}-poster/view` |
| Download PDF | `/{event}-poster/download` |
| Social share | `/{event}-poster/share` |
| With QR code | `/{event}-poster/with-qr-code` |

**For Player Signup:**
| Step | URL |
|------|-----|
| Start signup | `/{event}-signup` |
| Basic info | `/{event}-signup/player-info` |
| Pick team | `/{event}-signup/team-selection` |
| Payment | `/{event}-signup/payment` |
| Confirmation | `/{event}-signup/thank-you` |

---

**All URLs are case-insensitive and preserve query parameters!**
