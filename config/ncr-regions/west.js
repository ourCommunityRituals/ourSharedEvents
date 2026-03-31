/**
 * NCR Coverage — West Region
 * Mountain + Pacific
 * AZ, CO, ID, MT, NV, NM, UT, WY, AK, CA, HI, OR, WA
 *
 * 2 territories, 13 states
 * Level 4 (100k+) + Level 3 (max 5 per state)
 *
 * @module config/ncr-regions/west
 */

const territories = Object.freeze([
  { id: 'territory-mountain', name: 'Mountain', level: 6 },
  { id: 'territory-pacific', name: 'Pacific', level: 6 },
]);

const states = Object.freeze([
  { id: 'state-az', name: 'Arizona', state: 'AZ', level: 5, territory: 'territory-mountain' },
  { id: 'state-co', name: 'Colorado', state: 'CO', level: 5, territory: 'territory-mountain' },
  { id: 'state-id', name: 'Idaho', state: 'ID', level: 5, territory: 'territory-mountain' },
  { id: 'state-mt', name: 'Montana', state: 'MT', level: 5, territory: 'territory-mountain' },
  { id: 'state-nv', name: 'Nevada', state: 'NV', level: 5, territory: 'territory-mountain' },
  { id: 'state-nm', name: 'New Mexico', state: 'NM', level: 5, territory: 'territory-mountain' },
  { id: 'state-ut', name: 'Utah', state: 'UT', level: 5, territory: 'territory-mountain' },
  { id: 'state-wy', name: 'Wyoming', state: 'WY', level: 5, territory: 'territory-mountain' },
  { id: 'state-ak', name: 'Alaska', state: 'AK', level: 5, territory: 'territory-pacific' },
  { id: 'state-ca', name: 'California', state: 'CA', level: 5, territory: 'territory-pacific' },
  { id: 'state-hi', name: 'Hawaii', state: 'HI', level: 5, territory: 'territory-pacific' },
  { id: 'state-or', name: 'Oregon', state: 'OR', level: 5, territory: 'territory-pacific' },
  { id: 'state-wa', name: 'Washington', state: 'WA', level: 5, territory: 'territory-pacific' },
]);

const nodes = Object.freeze([
  // ─── ARIZONA ────────────────────────────────────────────────
  // Level 4
  { id: 'node-az-phoenix', name: 'Phoenix', state: 'AZ', level: 4, lat: 33.4484, lng: -112.0740 },
  { id: 'node-az-tucson', name: 'Tucson', state: 'AZ', level: 4, lat: 32.2226, lng: -110.9747 },
  { id: 'node-az-mesa', name: 'Mesa', state: 'AZ', level: 4, lat: 33.4152, lng: -111.8315 },
  { id: 'node-az-chandler', name: 'Chandler', state: 'AZ', level: 4, lat: 33.3062, lng: -111.8413 },
  { id: 'node-az-gilbert', name: 'Gilbert', state: 'AZ', level: 4, lat: 33.3528, lng: -111.7890 },
  { id: 'node-az-glendale', name: 'Glendale', state: 'AZ', level: 4, lat: 33.5387, lng: -112.1860 },
  { id: 'node-az-scottsdale', name: 'Scottsdale', state: 'AZ', level: 4, lat: 33.4942, lng: -111.9261 },
  { id: 'node-az-peoria', name: 'Peoria', state: 'AZ', level: 4, lat: 33.5806, lng: -112.2374 },
  { id: 'node-az-tempe', name: 'Tempe', state: 'AZ', level: 4, lat: 33.4255, lng: -111.9400 },
  { id: 'node-az-surprise', name: 'Surprise', state: 'AZ', level: 4, lat: 33.6292, lng: -112.3680 },
  { id: 'node-az-goodyear', name: 'Goodyear', state: 'AZ', level: 4, lat: 33.4353, lng: -112.3588 },
  { id: 'node-az-avondale', name: 'Avondale', state: 'AZ', level: 4, lat: 33.4356, lng: -112.3496 },
  // Level 3
  { id: 'node-az-flagstaff', name: 'Flagstaff', state: 'AZ', level: 3, lat: 35.1983, lng: -111.6513 },
  { id: 'node-az-yuma', name: 'Yuma', state: 'AZ', level: 3, lat: 32.6927, lng: -114.6277 },
  { id: 'node-az-prescott', name: 'Prescott', state: 'AZ', level: 3, lat: 34.5400, lng: -112.4685 },
  { id: 'node-az-lake-havasu-city', name: 'Lake Havasu City', state: 'AZ', level: 3, lat: 34.4839, lng: -114.3225 },
  { id: 'node-az-sedona', name: 'Sedona', state: 'AZ', level: 3, lat: 34.8697, lng: -111.7610 },

  // ─── COLORADO ───────────────────────────────────────────────
  // Level 4
  { id: 'node-co-denver', name: 'Denver', state: 'CO', level: 4, lat: 39.7392, lng: -104.9903 },
  { id: 'node-co-colorado-springs', name: 'Colorado Springs', state: 'CO', level: 4, lat: 38.8339, lng: -104.8214 },
  { id: 'node-co-aurora', name: 'Aurora', state: 'CO', level: 4, lat: 39.7294, lng: -104.8319 },
  { id: 'node-co-fort-collins', name: 'Fort Collins', state: 'CO', level: 4, lat: 40.5853, lng: -105.0844 },
  { id: 'node-co-lakewood', name: 'Lakewood', state: 'CO', level: 4, lat: 39.7047, lng: -105.0814 },
  { id: 'node-co-thornton', name: 'Thornton', state: 'CO', level: 4, lat: 39.8680, lng: -104.9719 },
  { id: 'node-co-arvada', name: 'Arvada', state: 'CO', level: 4, lat: 39.8028, lng: -105.0875 },
  { id: 'node-co-westminster', name: 'Westminster', state: 'CO', level: 4, lat: 39.8367, lng: -105.0372 },
  { id: 'node-co-pueblo', name: 'Pueblo', state: 'CO', level: 4, lat: 38.2544, lng: -104.6091 },
  { id: 'node-co-centennial', name: 'Centennial', state: 'CO', level: 4, lat: 39.5807, lng: -104.8772 },
  { id: 'node-co-boulder', name: 'Boulder', state: 'CO', level: 4, lat: 40.0150, lng: -105.2705 },
  { id: 'node-co-greeley', name: 'Greeley', state: 'CO', level: 4, lat: 40.4233, lng: -104.7091 },
  { id: 'node-co-longmont', name: 'Longmont', state: 'CO', level: 4, lat: 40.1672, lng: -105.1019 },
  { id: 'node-co-loveland', name: 'Loveland', state: 'CO', level: 4, lat: 40.3978, lng: -105.0750 },
  // Level 3
  { id: 'node-co-durango', name: 'Durango', state: 'CO', level: 3, lat: 37.2753, lng: -107.8801 },
  { id: 'node-co-grand-junction', name: 'Grand Junction', state: 'CO', level: 3, lat: 39.0639, lng: -108.5506 },
  { id: 'node-co-steamboat-springs', name: 'Steamboat Springs', state: 'CO', level: 3, lat: 40.4850, lng: -106.8317 },
  { id: 'node-co-aspen', name: 'Aspen', state: 'CO', level: 3, lat: 39.1911, lng: -106.8175 },
  { id: 'node-co-telluride', name: 'Telluride', state: 'CO', level: 3, lat: 37.9375, lng: -107.8123 },

  // ─── IDAHO ──────────────────────────────────────────────────
  // Level 4
  { id: 'node-id-boise', name: 'Boise', state: 'ID', level: 4, lat: 43.6150, lng: -116.2023 },
  { id: 'node-id-meridian', name: 'Meridian', state: 'ID', level: 4, lat: 43.6121, lng: -116.3915 },
  { id: 'node-id-nampa', name: 'Nampa', state: 'ID', level: 4, lat: 43.5407, lng: -116.5635 },

  // ─── MONTANA ────────────────────────────────────────────────
  // Level 3 only
  { id: 'node-mt-billings', name: 'Billings', state: 'MT', level: 3, lat: 45.7833, lng: -108.5007 },
  { id: 'node-mt-missoula', name: 'Missoula', state: 'MT', level: 3, lat: 46.8721, lng: -113.9940 },
  { id: 'node-mt-great-falls', name: 'Great Falls', state: 'MT', level: 3, lat: 47.5002, lng: -111.3008 },
  { id: 'node-mt-helena', name: 'Helena', state: 'MT', level: 3, lat: 46.5958, lng: -112.0270 },
  { id: 'node-mt-bozeman', name: 'Bozeman', state: 'MT', level: 3, lat: 45.6770, lng: -111.0429 },

  // ─── NEVADA ─────────────────────────────────────────────────
  // Level 4
  { id: 'node-nv-las-vegas', name: 'Las Vegas', state: 'NV', level: 4, lat: 36.1699, lng: -115.1398 },
  { id: 'node-nv-henderson', name: 'Henderson', state: 'NV', level: 4, lat: 36.0395, lng: -114.9817 },
  { id: 'node-nv-reno', name: 'Reno', state: 'NV', level: 4, lat: 39.5296, lng: -119.8138 },
  { id: 'node-nv-north-las-vegas', name: 'North Las Vegas', state: 'NV', level: 4, lat: 36.1989, lng: -115.1175 },
  { id: 'node-nv-sparks', name: 'Sparks', state: 'NV', level: 4, lat: 39.5349, lng: -119.7527 },

  // ─── NEW MEXICO ─────────────────────────────────────────────
  // Level 4
  { id: 'node-nm-albuquerque', name: 'Albuquerque', state: 'NM', level: 4, lat: 35.0844, lng: -106.6504 },
  { id: 'node-nm-las-cruces', name: 'Las Cruces', state: 'NM', level: 4, lat: 32.3199, lng: -106.7637 },
  { id: 'node-nm-rio-rancho', name: 'Rio Rancho', state: 'NM', level: 4, lat: 35.2328, lng: -106.6630 },

  // ─── UTAH ───────────────────────────────────────────────────
  // Level 4
  { id: 'node-ut-salt-lake-city', name: 'Salt Lake City', state: 'UT', level: 4, lat: 40.7608, lng: -111.8910 },
  { id: 'node-ut-west-valley-city', name: 'West Valley City', state: 'UT', level: 4, lat: 40.6916, lng: -111.9941 },
  { id: 'node-ut-west-jordan', name: 'West Jordan', state: 'UT', level: 4, lat: 40.6097, lng: -111.9391 },
  { id: 'node-ut-provo', name: 'Provo', state: 'UT', level: 4, lat: 40.2338, lng: -111.6585 },
  { id: 'node-ut-orem', name: 'Orem', state: 'UT', level: 4, lat: 40.2969, lng: -111.6946 },
  { id: 'node-ut-sandy', name: 'Sandy', state: 'UT', level: 4, lat: 40.5649, lng: -111.8590 },
  { id: 'node-ut-ogden', name: 'Ogden', state: 'UT', level: 4, lat: 41.2230, lng: -111.9738 },
  { id: 'node-ut-st-george', name: 'St George', state: 'UT', level: 4, lat: 37.0965, lng: -113.5684 },
  { id: 'node-ut-layton', name: 'Layton', state: 'UT', level: 4, lat: 41.0602, lng: -111.9711 },

  // ─── WYOMING ────────────────────────────────────────────────
  // Level 3 only
  { id: 'node-wy-cheyenne', name: 'Cheyenne', state: 'WY', level: 3, lat: 41.1400, lng: -104.8202 },
  { id: 'node-wy-casper', name: 'Casper', state: 'WY', level: 3, lat: 42.8666, lng: -106.3131 },
  { id: 'node-wy-laramie', name: 'Laramie', state: 'WY', level: 3, lat: 41.3114, lng: -105.5911 },
  { id: 'node-wy-jackson', name: 'Jackson', state: 'WY', level: 3, lat: 43.4799, lng: -110.7624 },
  { id: 'node-wy-gillette', name: 'Gillette', state: 'WY', level: 3, lat: 44.2911, lng: -105.5022 },

  // ─── ALASKA ─────────────────────────────────────────────────
  // Level 3 only
  { id: 'node-ak-anchorage', name: 'Anchorage', state: 'AK', level: 3, lat: 61.2181, lng: -149.9003 },
  { id: 'node-ak-fairbanks', name: 'Fairbanks', state: 'AK', level: 3, lat: 64.8378, lng: -147.7164 },
  { id: 'node-ak-juneau', name: 'Juneau', state: 'AK', level: 3, lat: 58.3005, lng: -134.4197 },

  // ─── CALIFORNIA ─────────────────────────────────────────────
  // Level 4
  { id: 'node-ca-los-angeles', name: 'Los Angeles', state: 'CA', level: 4, lat: 34.0522, lng: -118.2437 },
  { id: 'node-ca-san-diego', name: 'San Diego', state: 'CA', level: 4, lat: 32.7157, lng: -117.1611 },
  { id: 'node-ca-san-jose', name: 'San Jose', state: 'CA', level: 4, lat: 37.3382, lng: -121.8863 },
  { id: 'node-ca-san-francisco', name: 'San Francisco', state: 'CA', level: 4, lat: 37.7749, lng: -122.4194 },
  { id: 'node-ca-fresno', name: 'Fresno', state: 'CA', level: 4, lat: 36.7378, lng: -119.7871 },
  { id: 'node-ca-sacramento', name: 'Sacramento', state: 'CA', level: 4, lat: 38.5816, lng: -121.4944 },
  { id: 'node-ca-long-beach', name: 'Long Beach', state: 'CA', level: 4, lat: 33.7701, lng: -118.1937 },
  { id: 'node-ca-oakland', name: 'Oakland', state: 'CA', level: 4, lat: 37.8044, lng: -122.2712 },
  { id: 'node-ca-bakersfield', name: 'Bakersfield', state: 'CA', level: 4, lat: 35.3733, lng: -119.0187 },
  { id: 'node-ca-anaheim', name: 'Anaheim', state: 'CA', level: 4, lat: 33.8366, lng: -117.9143 },
  { id: 'node-ca-santa-ana', name: 'Santa Ana', state: 'CA', level: 4, lat: 33.7455, lng: -117.8677 },
  { id: 'node-ca-riverside', name: 'Riverside', state: 'CA', level: 4, lat: 33.9533, lng: -117.3962 },
  { id: 'node-ca-stockton', name: 'Stockton', state: 'CA', level: 4, lat: 37.9577, lng: -121.2908 },
  { id: 'node-ca-irvine', name: 'Irvine', state: 'CA', level: 4, lat: 33.6846, lng: -117.8265 },
  { id: 'node-ca-chula-vista', name: 'Chula Vista', state: 'CA', level: 4, lat: 32.6401, lng: -117.0842 },
  { id: 'node-ca-fremont', name: 'Fremont', state: 'CA', level: 4, lat: 37.5485, lng: -121.9886 },
  { id: 'node-ca-santa-clarita', name: 'Santa Clarita', state: 'CA', level: 4, lat: 34.3917, lng: -118.5426 },
  { id: 'node-ca-san-bernardino', name: 'San Bernardino', state: 'CA', level: 4, lat: 34.1083, lng: -117.2898 },
  { id: 'node-ca-moreno-valley', name: 'Moreno Valley', state: 'CA', level: 4, lat: 33.9425, lng: -117.2297 },
  { id: 'node-ca-fontana', name: 'Fontana', state: 'CA', level: 4, lat: 34.0922, lng: -117.4350 },
  { id: 'node-ca-modesto', name: 'Modesto', state: 'CA', level: 4, lat: 37.6391, lng: -120.9969 },
  { id: 'node-ca-glendale', name: 'Glendale', state: 'CA', level: 4, lat: 34.1425, lng: -118.2551 },
  { id: 'node-ca-huntington-beach', name: 'Huntington Beach', state: 'CA', level: 4, lat: 33.6595, lng: -117.9988 },
  { id: 'node-ca-garden-grove', name: 'Garden Grove', state: 'CA', level: 4, lat: 33.7743, lng: -117.9379 },
  { id: 'node-ca-oceanside', name: 'Oceanside', state: 'CA', level: 4, lat: 33.1959, lng: -117.3795 },
  { id: 'node-ca-rancho-cucamonga', name: 'Rancho Cucamonga', state: 'CA', level: 4, lat: 34.1064, lng: -117.5931 },
  { id: 'node-ca-ontario', name: 'Ontario', state: 'CA', level: 4, lat: 34.0633, lng: -117.6509 },
  { id: 'node-ca-santa-rosa', name: 'Santa Rosa', state: 'CA', level: 4, lat: 38.4405, lng: -122.7141 },
  { id: 'node-ca-elk-grove', name: 'Elk Grove', state: 'CA', level: 4, lat: 38.4088, lng: -121.3716 },
  { id: 'node-ca-corona', name: 'Corona', state: 'CA', level: 4, lat: 33.8753, lng: -117.5664 },
  { id: 'node-ca-lancaster', name: 'Lancaster', state: 'CA', level: 4, lat: 34.6868, lng: -118.1542 },
  { id: 'node-ca-palmdale', name: 'Palmdale', state: 'CA', level: 4, lat: 34.5794, lng: -118.1165 },
  { id: 'node-ca-salinas', name: 'Salinas', state: 'CA', level: 4, lat: 36.6777, lng: -121.6555 },
  { id: 'node-ca-hayward', name: 'Hayward', state: 'CA', level: 4, lat: 37.6688, lng: -122.0808 },
  { id: 'node-ca-pomona', name: 'Pomona', state: 'CA', level: 4, lat: 34.0551, lng: -117.7500 },
  { id: 'node-ca-escondido', name: 'Escondido', state: 'CA', level: 4, lat: 33.1192, lng: -117.0864 },
  { id: 'node-ca-sunnyvale', name: 'Sunnyvale', state: 'CA', level: 4, lat: 37.3688, lng: -122.0363 },
  { id: 'node-ca-torrance', name: 'Torrance', state: 'CA', level: 4, lat: 33.8358, lng: -118.3406 },
  { id: 'node-ca-pasadena', name: 'Pasadena', state: 'CA', level: 4, lat: 34.1478, lng: -118.1445 },
  { id: 'node-ca-roseville', name: 'Roseville', state: 'CA', level: 4, lat: 38.7521, lng: -121.2880 },
  { id: 'node-ca-visalia', name: 'Visalia', state: 'CA', level: 4, lat: 36.3302, lng: -119.2921 },
  { id: 'node-ca-concord', name: 'Concord', state: 'CA', level: 4, lat: 37.9780, lng: -122.0311 },
  { id: 'node-ca-thousand-oaks', name: 'Thousand Oaks', state: 'CA', level: 4, lat: 34.1706, lng: -118.8376 },
  { id: 'node-ca-simi-valley', name: 'Simi Valley', state: 'CA', level: 4, lat: 34.2694, lng: -118.7815 },
  { id: 'node-ca-santa-clara', name: 'Santa Clara', state: 'CA', level: 4, lat: 37.3541, lng: -121.9552 },
  { id: 'node-ca-victorville', name: 'Victorville', state: 'CA', level: 4, lat: 34.5362, lng: -117.2928 },
  { id: 'node-ca-vallejo', name: 'Vallejo', state: 'CA', level: 4, lat: 38.1041, lng: -122.2566 },
  { id: 'node-ca-berkeley', name: 'Berkeley', state: 'CA', level: 4, lat: 37.8716, lng: -122.2727 },
  { id: 'node-ca-el-monte', name: 'El Monte', state: 'CA', level: 4, lat: 34.0686, lng: -118.0276 },
  { id: 'node-ca-downey', name: 'Downey', state: 'CA', level: 4, lat: 33.9401, lng: -118.1332 },
  { id: 'node-ca-costa-mesa', name: 'Costa Mesa', state: 'CA', level: 4, lat: 33.6412, lng: -117.9187 },
  { id: 'node-ca-inglewood', name: 'Inglewood', state: 'CA', level: 4, lat: 33.9617, lng: -118.3531 },
  { id: 'node-ca-carlsbad', name: 'Carlsbad', state: 'CA', level: 4, lat: 33.1581, lng: -117.3506 },
  { id: 'node-ca-temecula', name: 'Temecula', state: 'CA', level: 4, lat: 33.4936, lng: -117.1484 },
  { id: 'node-ca-murrieta', name: 'Murrieta', state: 'CA', level: 4, lat: 33.5539, lng: -117.2139 },
  { id: 'node-ca-daly-city', name: 'Daly City', state: 'CA', level: 4, lat: 37.6879, lng: -122.4702 },
  { id: 'node-ca-burbank', name: 'Burbank', state: 'CA', level: 4, lat: 34.1808, lng: -118.3090 },
  { id: 'node-ca-el-cajon', name: 'El Cajon', state: 'CA', level: 4, lat: 32.7948, lng: -116.9625 },
  { id: 'node-ca-san-mateo', name: 'San Mateo', state: 'CA', level: 4, lat: 37.5630, lng: -122.3255 },
  { id: 'node-ca-rialto', name: 'Rialto', state: 'CA', level: 4, lat: 34.1064, lng: -117.3703 },
  { id: 'node-ca-compton', name: 'Compton', state: 'CA', level: 4, lat: 33.8958, lng: -118.2201 },
  { id: 'node-ca-vista', name: 'Vista', state: 'CA', level: 4, lat: 33.2000, lng: -117.2426 },
  { id: 'node-ca-south-gate', name: 'South Gate', state: 'CA', level: 4, lat: 33.9547, lng: -118.2120 },
  { id: 'node-ca-vacaville', name: 'Vacaville', state: 'CA', level: 4, lat: 38.3566, lng: -121.9877 },
  { id: 'node-ca-carson', name: 'Carson', state: 'CA', level: 4, lat: 33.8317, lng: -118.2820 },
  { id: 'node-ca-hesperia', name: 'Hesperia', state: 'CA', level: 4, lat: 34.4264, lng: -117.3009 },
  { id: 'node-ca-santa-maria', name: 'Santa Maria', state: 'CA', level: 4, lat: 34.9530, lng: -120.4357 },
  { id: 'node-ca-santa-barbara', name: 'Santa Barbara', state: 'CA', level: 4, lat: 34.4208, lng: -119.6982 },
  { id: 'node-ca-chico', name: 'Chico', state: 'CA', level: 4, lat: 39.7285, lng: -121.8375 },
  { id: 'node-ca-san-leandro', name: 'San Leandro', state: 'CA', level: 4, lat: 37.7249, lng: -122.1561 },
  { id: 'node-ca-san-marcos', name: 'San Marcos', state: 'CA', level: 4, lat: 33.1434, lng: -117.1661 },
  { id: 'node-ca-tracy', name: 'Tracy', state: 'CA', level: 4, lat: 37.7397, lng: -121.4252 },
  { id: 'node-ca-livermore', name: 'Livermore', state: 'CA', level: 4, lat: 37.6819, lng: -121.7680 },
  { id: 'node-ca-merced', name: 'Merced', state: 'CA', level: 4, lat: 37.3022, lng: -120.4830 },
  { id: 'node-ca-indio', name: 'Indio', state: 'CA', level: 4, lat: 33.7206, lng: -116.2156 },
  { id: 'node-ca-napa', name: 'Napa', state: 'CA', level: 4, lat: 38.2975, lng: -122.2869 },
  { id: 'node-ca-mountain-view', name: 'Mountain View', state: 'CA', level: 4, lat: 37.3861, lng: -122.0839 },
  { id: 'node-ca-redding', name: 'Redding', state: 'CA', level: 4, lat: 40.5865, lng: -122.3917 },
  // Level 3
  { id: 'node-ca-santa-cruz', name: 'Santa Cruz', state: 'CA', level: 3, lat: 36.9741, lng: -122.0308 },
  { id: 'node-ca-san-luis-obispo', name: 'San Luis Obispo', state: 'CA', level: 3, lat: 35.2828, lng: -120.6596 },
  { id: 'node-ca-monterey', name: 'Monterey', state: 'CA', level: 3, lat: 36.6002, lng: -121.8947 },
  { id: 'node-ca-davis', name: 'Davis', state: 'CA', level: 3, lat: 38.5449, lng: -121.7405 },
  { id: 'node-ca-eureka', name: 'Eureka', state: 'CA', level: 3, lat: 40.8021, lng: -124.1637 },

  // ─── HAWAII ─────────────────────────────────────────────────
  // Level 3 only
  { id: 'node-hi-honolulu', name: 'Honolulu', state: 'HI', level: 3, lat: 21.3069, lng: -157.8583 },
  { id: 'node-hi-hilo', name: 'Hilo', state: 'HI', level: 3, lat: 19.7241, lng: -155.0868 },
  { id: 'node-hi-kailua', name: 'Kailua', state: 'HI', level: 3, lat: 21.4022, lng: -157.7394 },
  { id: 'node-hi-kahului', name: 'Kahului', state: 'HI', level: 3, lat: 20.8893, lng: -156.4729 },

  // ─── OREGON ─────────────────────────────────────────────────
  // Level 4
  { id: 'node-or-portland', name: 'Portland', state: 'OR', level: 4, lat: 45.5152, lng: -122.6784 },
  { id: 'node-or-salem', name: 'Salem', state: 'OR', level: 4, lat: 44.9429, lng: -123.0351 },
  { id: 'node-or-eugene', name: 'Eugene', state: 'OR', level: 4, lat: 44.0521, lng: -123.0868 },
  { id: 'node-or-gresham', name: 'Gresham', state: 'OR', level: 4, lat: 45.5001, lng: -122.4302 },
  { id: 'node-or-hillsboro', name: 'Hillsboro', state: 'OR', level: 4, lat: 45.5229, lng: -122.9898 },
  { id: 'node-or-beaverton', name: 'Beaverton', state: 'OR', level: 4, lat: 45.4871, lng: -122.8037 },
  { id: 'node-or-bend', name: 'Bend', state: 'OR', level: 4, lat: 44.0582, lng: -121.3153 },
  { id: 'node-or-medford', name: 'Medford', state: 'OR', level: 4, lat: 42.3265, lng: -122.8756 },

  // ─── WASHINGTON ─────────────────────────────────────────────
  // Level 4
  { id: 'node-wa-seattle', name: 'Seattle', state: 'WA', level: 4, lat: 47.6062, lng: -122.3321 },
  { id: 'node-wa-spokane', name: 'Spokane', state: 'WA', level: 4, lat: 47.6588, lng: -117.4260 },
  { id: 'node-wa-tacoma', name: 'Tacoma', state: 'WA', level: 4, lat: 47.2529, lng: -122.4443 },
  { id: 'node-wa-vancouver', name: 'Vancouver', state: 'WA', level: 4, lat: 45.6387, lng: -122.6615 },
  { id: 'node-wa-bellevue', name: 'Bellevue', state: 'WA', level: 4, lat: 47.6101, lng: -122.2015 },
  { id: 'node-wa-kent', name: 'Kent', state: 'WA', level: 4, lat: 47.3809, lng: -122.2348 },
  { id: 'node-wa-everett', name: 'Everett', state: 'WA', level: 4, lat: 47.9790, lng: -122.2021 },
  { id: 'node-wa-renton', name: 'Renton', state: 'WA', level: 4, lat: 47.4829, lng: -122.2171 },
]);

module.exports = { territories, states, nodes };
