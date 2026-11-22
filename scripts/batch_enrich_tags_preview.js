'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { parseFrontmatter, stringifyFrontmatter } = require('./lib/frontmatter');

// Tiny .env loader
const envPath = path.join(ROOT, '.env');
let GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
let GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) {
      if (m[1] === 'GEMINI_API_KEY') GEMINI_API_KEY = m[2].replace(/^['"]|['"]$/g, '');
      if (m[1] === 'GEMINI_MODEL') GEMINI_MODEL = m[2].replace(/^['"]|['"]$/g, '');
    }
  });
}

if (!GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY is missing in .env');
  process.exit(1);
}

const TAGS_PATH = path.join(ROOT, 'data', 'tags.json');
let tagsData = { tags: [] };
try {
  tagsData = JSON.parse(fs.readFileSync(TAGS_PATH, 'utf8'));
} catch (_) {}

function saveTagStore(newTags) {
  let changed = false;
  newTags.forEach(t => {
    if (t && typeof t === 'string' && !tagsData.tags.includes(t)) {
      tagsData.tags.push(t);
      changed = true;
    }
  });
  if (changed) {
    fs.writeFileSync(TAGS_PATH, JSON.stringify(tagsData, null, 2) + '\n');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callGeminiWithRetry(prompt, title, maxRetries = 6) {
  const models = [GEMINI_MODEL, 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'].filter((v, i, a) => v && a.indexOf(v) === i);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    for (const m of models) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
      };

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const raw = await res.text();
        let data;
        try { data = JSON.parse(raw); } catch (_) {}

        if (!res.ok) {
          const msg = data?.error?.message || `HTTP ${res.status}`;
          if (res.status === 429 || res.status === 503) {
            continue;
          }
          throw new Error(msg);
        }

        const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
        if (!text) continue;
        const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
        return JSON.parse(cleaned);

      } catch (err) {
        if (attempt === maxRetries && m === models[models.length - 1]) throw err;
      }
    }

    const waitSeconds = attempt * 8;
    console.log(`[Rate limit / Server busy] Waiting ${waitSeconds}s before retry (Attempt ${attempt}/${maxRetries}) for "${title}"...`);
    await sleep(waitSeconds * 1000);
  }
  throw new Error(`Failed after ${maxRetries} retries.`);
}

async function run() {
  const folders = ['blogs', 'essays', 'reviews', 'verses', 'notes'];
  const allFiles = [];

  for (const f of folders) {
    const dir = path.join(ROOT, 'content', f);
    if (!fs.existsSync(dir)) continue;
    fs.readdirSync(dir).filter(x => x.endsWith('.md')).forEach(x => {
      allFiles.push({ folder: f, file: x, path: path.join(dir, x) });
    });
  }

  console.log(`Found ${allFiles.length} total posts in content/`);
  let processed = 0;
  let skipped = 0;

  for (let i = 0; i < allFiles.length; i++) {
    const item = allFiles[i];
    const raw = fs.readFileSync(item.path, 'utf8');
    const { data, body } = parseFrontmatter(raw);

    const hasTags = Array.isArray(data.tags) && data.tags.length > 0;
    const isNote = item.folder === 'notes';
    const hasPreview = isNote ? true : (typeof data.preview === 'string' && data.preview.trim().length > 0);

    if (hasTags && hasPreview) {
      skipped++;
      continue;
    }

    const title = data.title || item.file.replace(/\.md$/, '');
    console.log(`[${i + 1}/${allFiles.length}] Enriching: [${item.folder}] ${title}...`);

    const prompt = `You are the editorial assistant for Last Page (the personal website of O IV).
Read this writing by O IV:
Folder: ${item.folder}
Title: ${title}
Content:
${body.slice(0, 3000)}

TASK:
1. "tags": Return an array of 4 to 6 specific, relevant tags (e.g. topics, people, themes, works).
${isNote ? '' : '2. "preview": Return a concise, engaging 1-2 sentence preview text (under 160 characters) suitable for article card previews and RSS description.'}

Return JSON:
{
  "tags": ["Tag1", "Tag2", "Tag3", "Tag4"]${isNote ? '' : ',\n  "preview": "Concise summary under 160 characters"'}
}`;

    try {
      const res = await callGeminiWithRetry(prompt, title);
      let updated = false;

      if (!hasTags && Array.isArray(res.tags) && res.tags.length) {
        data.tags = res.tags;
        saveTagStore(res.tags);
        updated = true;
      }

      if (!isNote && !hasPreview && res.preview) {
        data.preview = res.preview.trim();
        updated = true;
      }

      if (updated) {
        fs.writeFileSync(item.path, stringifyFrontmatter(data, body));
        processed++;
        console.log(`  -> Added tags: [${(data.tags || []).join(', ')}]`);
        if (data.preview) console.log(`  -> Preview: "${data.preview}"`);
      }

      await sleep(1200); // 1.2s delay between requests
    } catch (err) {
      console.error(`  -> Failed on ${item.file}:`, err.message);
    }
  }

  console.log(`\nEnrichment finished. Processed: ${processed}, Already complete: ${skipped}`);

  if (processed > 0) {
    console.log('\nRebuilding static site with new tags and previews...');
    execFileSync('node', ['scripts/build.js'], { cwd: ROOT, stdio: 'inherit' });

    console.log('\nCommitting and pushing changes to GitHub...');
    execFileSync('git', ['add', 'content/', 'data/tags.json', 'site/'], { cwd: ROOT, stdio: 'inherit' });
    execFileSync('git', ['commit', '-m', `Enrich ${processed} existing writings with AI tags and preview text`], { cwd: ROOT, stdio: 'inherit' });
    execFileSync('git', ['push'], { cwd: ROOT, stdio: 'inherit' });
    console.log('Successfully pushed all changes to GitHub!');
  } else {
    console.log('No new files needed updating.');
  }
}

run().catch(err => {
  console.error('Fatal batch script error:', err);
  process.exit(1);
});
