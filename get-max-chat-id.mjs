// Вытаскивает chat_id из MAX Bot API: нажми Start у бота в MAX, затем запусти
//   node get-max-chat-id.mjs <TOKEN>
// Скрипт читает последние события бота и печатает все найденные chat_id.
const token = process.argv[2];
if (!token) { console.error('Использование: node get-max-chat-id.mjs <TOKEN>'); process.exit(1); }
let marker = '';
const seen = new Set();
for (let page = 0; page < 5; page++) {
  const res = await fetch(`https://platform-api2.max.ru/updates${marker ? `?marker=${marker}` : ''}`, {
    headers: { 'Authorization': token }
  });
  if (!res.ok) { console.error('HTTP', res.status, (await res.text()).slice(0, 300)); process.exit(1); }
  const json = await res.json();
  for (const u of json.updates || []) {
    const cid = u.chat_id ?? u.recipient?.chat_id ?? u.message?.recipient?.chat_id;
    if (cid) { seen.add(cid); console.log(`chat_id: ${cid}  (тип события: ${u.update_type || '—'})`); }
  }
  if (!json.marker) break;
  marker = json.marker;
}
if (!seen.size) {
  console.log('Событий с chat_id нет. Открой бота в MAX и нажми Start (напиши что угодно), потом запусти скрипт ещё раз.');
} else {
  console.log(`\nИтого chat_id: ${[...seen].join(', ')} — это и есть твой MAX_CHAT_ID`);
}
