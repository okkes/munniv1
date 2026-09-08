// Vendors the offline brand-icon set for recurring costs: downloads the
// curated list below from cdn.simpleicons.org (default = brand color)
// into public/brands/ and writes public/brands/index.json. Slugs that
// 404 are skipped, so the list may aim generously.
//
//   node scripts/fetch-brand-icons.mjs
//
// Re-running only downloads missing files (delete public/brands to redo).
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '../public/brands');

/** [simpleicons slug, display title] — popular subscriptions & recurring services */
const BRANDS = [
  // streaming video
  ['netflix', 'Netflix'], ['disneyplus', 'Disney+'], ['hbo', 'HBO'], ['hbomax', 'HBO Max'],
  ['primevideo', 'Prime Video'], ['appletv', 'Apple TV'], ['paramountplus', 'Paramount+'],
  ['hulu', 'Hulu'], ['crunchyroll', 'Crunchyroll'], ['dazn', 'DAZN'], ['mubi', 'MUBI'],
  ['rakutentv', 'Rakuten TV'], ['nowtv', 'NOW'], ['skyshowtime', 'SkyShowtime'],
  ['youtube', 'YouTube'], ['youtubetv', 'YouTube TV'], ['twitch', 'Twitch'], ['vimeo', 'Vimeo'],
  ['plex', 'Plex'], ['peacock', 'Peacock'], ['curiositystream', 'CuriosityStream'],
  ['nebula', 'Nebula'], ['funimation', 'Funimation'], ['viaplay', 'Viaplay'],
  // music & audio
  ['spotify', 'Spotify'], ['applemusic', 'Apple Music'], ['youtubemusic', 'YouTube Music'],
  ['deezer', 'Deezer'], ['tidal', 'Tidal'], ['soundcloud', 'SoundCloud'], ['pandora', 'Pandora'],
  ['audible', 'Audible'], ['audiomack', 'Audiomack'], ['bandcamp', 'Bandcamp'],
  ['podimo', 'Podimo'], ['pocketcasts', 'Pocket Casts'], ['overcast', 'Overcast'],
  ['lastdotfm', 'Last.fm'], ['shazam', 'Shazam'], ['storytel', 'Storytel'],
  // cloud & productivity
  ['icloud', 'iCloud'], ['googledrive', 'Google Drive'], ['googleone', 'Google One'],
  ['dropbox', 'Dropbox'], ['box', 'Box'], ['mega', 'MEGA'], ['pcloud', 'pCloud'],
  ['backblaze', 'Backblaze'], ['notion', 'Notion'], ['evernote', 'Evernote'],
  ['todoist', 'Todoist'], ['ticktick', 'TickTick'], ['asana', 'Asana'], ['trello', 'Trello'],
  ['monday', 'Monday.com'], ['clickup', 'ClickUp'], ['airtable', 'Airtable'],
  ['slack', 'Slack'], ['zoom', 'Zoom'], ['googlemeet', 'Google Meet'], ['obsidian', 'Obsidian'],
  ['miro', 'Miro'], ['linear', 'Linear'], ['basecamp', 'Basecamp'], ['calendly', 'Calendly'],
  ['grammarly', 'Grammarly'], ['deepl', 'DeepL'], ['zapier', 'Zapier'], ['ifttt', 'IFTTT'],
  ['make', 'Make'], ['loom', 'Loom'], ['otter', 'Otter.ai'],
  // design & creative
  ['figma', 'Figma'], ['sketch', 'Sketch'], ['canva', 'Canva'], ['adobe', 'Adobe'],
  ['adobecreativecloud', 'Adobe Creative Cloud'], ['adobephotoshop', 'Photoshop'],
  ['adobelightroom', 'Lightroom'], ['adobepremierepro', 'Premiere Pro'],
  ['adobeillustrator', 'Illustrator'], ['adobeacrobatreader', 'Adobe Acrobat'],
  ['affinitydesigner', 'Affinity Designer'], ['procreate', 'Procreate'],
  ['unsplash', 'Unsplash'], ['shutterstock', 'Shutterstock'], ['envato', 'Envato'],
  ['dribbble', 'Dribbble'], ['behance', 'Behance'],
  // developer & hosting
  ['github', 'GitHub'], ['gitlab', 'GitLab'], ['bitbucket', 'Bitbucket'],
  ['jetbrains', 'JetBrains'], ['digitalocean', 'DigitalOcean'], ['hetzner', 'Hetzner'],
  ['linode', 'Linode'], ['vultr', 'Vultr'], ['netlify', 'Netlify'], ['vercel', 'Vercel'],
  ['heroku', 'Heroku'], ['cloudflare', 'Cloudflare'], ['namecheap', 'Namecheap'],
  ['godaddy', 'GoDaddy'], ['ovh', 'OVH'], ['docker', 'Docker'], ['jsdelivr', 'jsDelivr'],
  ['openai', 'OpenAI'], ['anthropic', 'Anthropic'], ['perplexity', 'Perplexity'],
  ['googlegemini', 'Gemini'], ['githubcopilot', 'GitHub Copilot'], ['replit', 'Replit'],
  ['codecademy', 'Codecademy'], ['freecodecamp', 'freeCodeCamp'], ['pluralsight', 'Pluralsight'],
  ['udemy', 'Udemy'], ['coursera', 'Coursera'], ['edx', 'edX'], ['skillshare', 'Skillshare'],
  ['datacamp', 'DataCamp'], ['leetcode', 'LeetCode'], ['brilliant', 'Brilliant'],
  ['duolingo', 'Duolingo'], ['babbel', 'Babbel'], ['busuu', 'Busuu'], ['memrise', 'Memrise'],
  // gaming
  ['playstation', 'PlayStation'], ['xbox', 'Xbox'], ['nintendoswitch', 'Nintendo Switch'],
  ['nintendo', 'Nintendo'], ['steam', 'Steam'], ['epicgames', 'Epic Games'], ['gogdotcom', 'GOG'],
  ['ea', 'EA'], ['ubisoft', 'Ubisoft'], ['battledotnet', 'Battle.net'], ['riotgames', 'Riot Games'],
  ['rockstargames', 'Rockstar Games'], ['discord', 'Discord'], ['roblox', 'Roblox'],
  ['minecraft', 'Minecraft'], ['worldofwarcraft', 'World of Warcraft'], ['fortnite', 'Fortnite'],
  ['leagueoflegends', 'League of Legends'], ['humblebundle', 'Humble Bundle'], ['itchdotio', 'itch.io'],
  ['gamejolt', 'Game Jolt'], ['chessdotcom', 'Chess.com'], ['lichess', 'Lichess'],
  // security & VPN
  ['1password', '1Password'], ['lastpass', 'LastPass'], ['bitwarden', 'Bitwarden'],
  ['dashlane', 'Dashlane'], ['nordvpn', 'NordVPN'], ['expressvpn', 'ExpressVPN'],
  ['protonvpn', 'Proton VPN'], ['proton', 'Proton'], ['protonmail', 'Proton Mail'],
  ['mullvad', 'Mullvad'], ['surfshark', 'Surfshark'], ['tailscale', 'Tailscale'],
  ['malwarebytes', 'Malwarebytes'], ['norton', 'Norton'], ['mcafee', 'McAfee'],
  ['avast', 'Avast'], ['bitdefender', 'Bitdefender'], ['kaspersky', 'Kaspersky'],
  // telecom & internet
  ['vodafone', 'Vodafone'], ['kpn', 'KPN'], ['t-mobile', 'T-Mobile'], ['o2', 'O2'],
  ['orange', 'Orange'], ['verizon', 'Verizon'], ['at-and-t', 'AT&T'], ['three', 'Three'],
  ['ee', 'EE'], ['turkcell', 'Turkcell'], ['turktelekom', 'Türk Telekom'],
  ['telegram', 'Telegram'], ['whatsapp', 'WhatsApp'], ['signal', 'Signal'], ['viber', 'Viber'],
  ['skype', 'Skype'],
  // finance & payments
  ['paypal', 'PayPal'], ['klarna', 'Klarna'], ['revolut', 'Revolut'], ['n26', 'N26'],
  ['bunq', 'bunq'], ['wise', 'Wise'], ['stripe', 'Stripe'], ['coinbase', 'Coinbase'],
  ['binance', 'Binance'], ['kraken', 'Kraken'], ['robinhood', 'Robinhood'], ['etoro', 'eToro'],
  ['trading212', 'Trading 212'], ['degiro', 'DEGIRO'], ['ing', 'ING'], ['rabobank', 'Rabobank'],
  ['abnamro', 'ABN AMRO'], ['americanexpress', 'American Express'], ['mastercard', 'Mastercard'],
  ['visa', 'Visa'], ['venmo', 'Venmo'], ['cashapp', 'Cash App'], ['monzo', 'Monzo'],
  ['starlingbank', 'Starling Bank'], ['santander', 'Santander'], ['hsbc', 'HSBC'],
  ['patreon', 'Patreon'], ['kofi', 'Ko-fi'], ['buymeacoffee', 'Buy Me a Coffee'],
  ['gofundme', 'GoFundMe'], ['kickstarter', 'Kickstarter'],
  // shopping & delivery
  ['amazon', 'Amazon'], ['ebay', 'eBay'], ['aliexpress', 'AliExpress'], ['etsy', 'Etsy'],
  ['zalando', 'Zalando'], ['asos', 'ASOS'], ['hellofresh', 'HelloFresh'],
  ['ubereats', 'Uber Eats'], ['uber', 'Uber'], ['deliveroo', 'Deliveroo'],
  ['doordash', 'DoorDash'], ['grubhub', 'Grubhub'], ['justeat', 'Just Eat'],
  ['instacart', 'Instacart'], ['getir', 'Getir'], ['bolt', 'Bolt'], ['lyft', 'Lyft'],
  ['lime', 'Lime'], ['tier', 'TIER'], ['flixbus', 'FlixBus'], ['blablacar', 'BlaBlaCar'],
  ['airbnb', 'Airbnb'], ['booking', 'Booking.com'], ['expedia', 'Expedia'],
  ['tripadvisor', 'Tripadvisor'], ['trainline', 'Trainline'], ['ryanair', 'Ryanair'],
  ['easyjet', 'easyJet'], ['klm', 'KLM'], ['lufthansa', 'Lufthansa'],
  ['turkishairlines', 'Turkish Airlines'], ['pegasusairlines', 'Pegasus'],
  // fitness & health
  ['strava', 'Strava'], ['fitbit', 'Fitbit'], ['garmin', 'Garmin'], ['myfitnesspal', 'MyFitnessPal'],
  ['nike', 'Nike'], ['adidas', 'Adidas'], ['underarmour', 'Under Armour'], ['peloton', 'Peloton'],
  ['headspace', 'Headspace'], ['calm', 'Calm'], ['whoop', 'WHOOP'], ['polar', 'Polar'],
  ['komoot', 'Komoot'], ['alltrails', 'AllTrails'],
  // news & reading
  ['nytimes', 'The New York Times'], ['theguardian', 'The Guardian'],
  ['thewashingtonpost', 'The Washington Post'], ['wsj', 'The Wall Street Journal'],
  ['financialtimes', 'Financial Times'], ['bloomberg', 'Bloomberg'], ['reuters', 'Reuters'],
  ['theeconomist', 'The Economist'], ['wired', 'WIRED'], ['medium', 'Medium'],
  ['substack', 'Substack'], ['pocket', 'Pocket'], ['feedly', 'Feedly'], ['inoreader', 'Inoreader'],
  ['goodreads', 'Goodreads'], ['kindle', 'Kindle'], ['kobo', 'Kobo'], ['scribd', 'Scribd'],
  ['blinkist', 'Blinkist'],
  // social & dating
  ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['x', 'X'], ['linkedin', 'LinkedIn'],
  ['reddit', 'Reddit'], ['pinterest', 'Pinterest'], ['snapchat', 'Snapchat'], ['tiktok', 'TikTok'],
  ['tinder', 'Tinder'], ['bumble', 'Bumble'], ['hinge', 'Hinge'], ['mastodon', 'Mastodon'],
  ['bluesky', 'Bluesky'], ['threads', 'Threads'], ['onlyfans', 'OnlyFans'],
  // tech & hardware ecosystems
  ['apple', 'Apple'], ['google', 'Google'], ['samsung', 'Samsung'], ['xiaomi', 'Xiaomi'],
  ['huawei', 'Huawei'], ['sonos', 'Sonos'], ['philipshue', 'Philips Hue'], ['ring', 'Ring'],
  ['nest', 'Nest'], ['tesla', 'Tesla'], ['dyson', 'Dyson'], ['bosch', 'Bosch'],
  ['siemens', 'Siemens'], ['lg', 'LG'], ['sony', 'Sony'], ['roku', 'Roku'], ['synology', 'Synology'],
  ['ubiquiti', 'Ubiquiti'], ['tplink', 'TP-Link'], ['asus', 'ASUS'], ['logitech', 'Logitech'],
  // software & OS
  ['googleplay', 'Google Play'], ['appstore', 'App Store'], ['microsoft', 'Microsoft'],
  ['windows', 'Windows'], ['office', 'Microsoft Office'], ['microsoftonedrive', 'OneDrive'],
  ['microsoftteams', 'Microsoft Teams'], ['microsoft365', 'Microsoft 365'],
  ['googlechrome', 'Chrome'], ['firefox', 'Firefox'], ['opera', 'Opera'], ['brave', 'Brave'],
  ['linux', 'Linux'], ['ubuntu', 'Ubuntu'], ['raspberrypi', 'Raspberry Pi'],
  ['homeassistant', 'Home Assistant'], ['nextcloud', 'Nextcloud'], ['tampermonkey', 'Tampermonkey'],
  ['setapp', 'Setapp'], ['parallels', 'Parallels'],
  // household & misc
  ['ikea', 'IKEA'], ['leroymerlin', 'Leroy Merlin'], ['bricodepot', 'Brico Dépôt'],
  ['carrefour', 'Carrefour'], ['lidl', 'Lidl'], ['aldinord', 'ALDI'], ['tesco', 'Tesco'],
  ['walmart', 'Walmart'], ['target', 'Target'], ['costco', 'Costco'], ['decathlon', 'Decathlon'],
  ['mediamarkt', 'MediaMarkt'], ['starbucks', 'Starbucks'], ["mcdonalds", "McDonald's"],
  ['burgerking', 'Burger King'], ['kfc', 'KFC'], ['dominos', "Domino's"], ['subway', 'Subway'],
];

// Dev-only vendoring: fetches from the fixed simpleicons CDN and returns
// the body ONLY when it is actually an SVG, so an error/HTML page can
// never be written to disk as a .svg (the filename itself comes from the
// hardcoded BRANDS allowlist, never from the network).
async function fetchIcon(slug) {
  const res = await fetch(`https://cdn.simpleicons.org/${slug}`);
  if (!res.ok) return null;
  const body = await res.text();
  return body.trimStart().startsWith('<svg') ? body : null;
}

const existing = new Set(await readdir(OUT).catch(() => []));
await mkdir(OUT, { recursive: true });

const kept = [];
let downloaded = 0;
for (const [slug, title] of BRANDS) {
  const file = `${slug}.svg`;
  if (existing.has(file)) {
    kept.push({ slug, title });
    continue;
  }
  const svg = await fetchIcon(slug);
  if (svg === null) {
    console.warn(`skip (404): ${slug}`);
    continue;
  }
  await writeFile(path.join(OUT, file), svg, 'utf8');
  kept.push({ slug, title });
  downloaded++;
}

kept.sort((a, b) => a.title.localeCompare(b.title));
await writeFile(path.join(OUT, 'index.json'), JSON.stringify(kept), 'utf8');
console.log(`brands: ${kept.length} kept (${downloaded} downloaded, ${BRANDS.length - kept.length} skipped)`);
