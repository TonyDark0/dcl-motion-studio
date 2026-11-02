import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const languages = ['es', 'ja', 'de', 'ru', 'ar', 'zh'];
const out = Object.fromEntries(languages.map((id) => [id, {}]));
for (const file of readdirSync('src/locales').filter((f) => f.endsWith('.tsv'))) {
  for (const line of readFileSync('src/locales/' + file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean)) {
    const [key, ...values] = line.split('|');
    if (!key || values.length !== 6 || values.some((v) => !v.trim()))
      throw Error(file + ': invalid row ' + key);
    languages.forEach((id, i) => {
      out[id][key] = values[i];
    });
  }
}
writeFileSync('src/locales/messages.json', JSON.stringify(out, null, 2) + '\n');
