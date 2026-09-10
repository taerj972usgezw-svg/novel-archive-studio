try { require('dotenv').config(); } catch (e) {}
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1546893744412950588/E3Tquk7hSu_p9MOKhgg7E6XIl2X7xfKKadTKQEVvDYuz3NFAJEkK47QNqFGE8SjVY4yx';
const ADMIN_ID = process.env.ADMIN_ID || 'taeiyoon';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'a3253511!';
const SERVICE_DOMAIN = process.env.SERVICE_DOMAIN || '소설.메인.한국';

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// DB 파일 헬퍼
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(filename, defaultVal = []) {
  try {
    const p = path.join(DATA_DIR, filename);
    if (!fs.existsSync(p)) return defaultVal;
    const raw = fs.readFileSync(p, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[DB] Error reading ${filename}:`, err.message);
    return defaultVal;
  }
}

function writeJSON(filename, data) {
  try {
    const p = path.join(DATA_DIR, filename);
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`[DB] Error writing ${filename}:`, err.message);
    return false;
  }
}

// 디스코드 웹훅 발송 헬퍼
function sendDiscordWebhook(payload) {
  if (!DISCORD_WEBHOOK_URL || !DISCORD_WEBHOOK_URL.startsWith('http')) return;
  try {
    const url = new URL(DISCORD_WEBHOOK_URL);
    const postData = JSON.stringify(payload);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      res.on('data', () => {});
    });
    req.on('error', (e) => console.error('[Discord] Webhook send error:', e.message));
    req.write(postData);
    req.end();
  } catch (err) {
    console.error('[Discord] Parse error:', err.message);
  }
}

// IP별 디스코드 쿨다운 (3분)
const visitorCooldownMap = new Map();
const COOLDOWN_MS = 3 * 60 * 1000;

// 클라이언트 IP 추출 헬퍼
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

// ─── 1. 텔레메트리 API ─────────────────────────────────────────────
app.post('/api/telemetry', (req, res) => {
  try {
    const ip = getClientIp(req);
    const data = req.body || {};
    const now = Date.now();
    const isoTime = new Date().toISOString();

    const isNew = Number(data.visitCount || 1) <= 1;
    const lastVisitTime = visitorCooldownMap.get(ip) || 0;
    const canSendWebhook = (now - lastVisitTime) > COOLDOWN_MS;

    // 방문 로그 저장
    const visitors = readJSON('visitors.json', []);
    const logEntry = {
      id: `v-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      ip: ip,
      vid: data.vid || 'unknown',
      visitCount: data.visitCount || 1,
      sessionId: data.sessionId || '',
      gpu: data.gpu || 'Unknown GPU',
      cores: data.cores || 'N/A',
      memory: data.memory || 'N/A',
      touchPoints: data.touchPoints || 0,
      screen: data.screen || 'N/A',
      viewport: data.viewport || 'N/A',
      dpr: data.dpr || 1,
      connection: data.connection || 'N/A',
      referrer: data.referrer || '직접 접속',
      channel: data.channel || '웹포워딩 / 직접접속',
      currentUrl: data.currentUrl || '',
      userAgent: req.headers['user-agent'] || '',
      timestamp: isoTime
    };

    visitors.unshift(logEntry);
    if (visitors.length > 500) visitors.length = 500; // 최대 500개 보관
    writeJSON('visitors.json', visitors);

    if (canSendWebhook) {
      visitorCooldownMap.set(ip, now);
      const badge = isNew ? '🔴 [신규 첫 방문]' : `🔵 [재방문 ${data.visitCount || 2}회차]`;
      const embedColor = isNew ? 0xE74C3C : 0x3498DB;

      const embed = {
        title: `${badge} 소설 아카이브 스튜디오 실시간 접속 감지`,
        description: `**접속 도메인:** \`${data.currentHost || SERVICE_DOMAIN}\`\n**유입 채널:** \`${logEntry.channel}\`\n**이전 출처:** ${logEntry.referrer}`,
        color: embedColor,
        fields: [
          { name: '🌐 네트워크 & IP', value: `IP: \`${ip}\`\n회선: \`${logEntry.connection}\``, inline: true },
          { name: '📱 기기 화면', value: `해상도: \`${logEntry.screen}\`\n뷰포트: \`${logEntry.viewport}\` (DPR ${logEntry.dpr})`, inline: true },
          { name: '⚡ 하드웨어 스펙', value: `GPU: \`${logEntry.gpu}\`\nCPU 코어: \`${logEntry.cores}\` / RAM: \`${logEntry.memory}GB\`\n터치포인트: \`${logEntry.touchPoints}\``, inline: false },
          { name: '🆔 방문자 식별자', value: `고유 VID: \`${logEntry.vid.slice(0, 16)}...\`\n누적 방문: **${logEntry.visitCount}회**`, inline: true },
          { name: '🕒 접속 일시', value: `${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (KST)`, inline: true }
        ],
        footer: { text: `소설.메인.한국 • 텔레메트리 모니터링 엔진` }
      };

      sendDiscordWebhook({
        username: '소설 스튜디오 텔레메트리 봇',
        avatar_url: 'https://cdn-icons-png.flaticon.com/512/3389/3389081.png',
        embeds: [embed]
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Telemetry Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 2. 소설 API ───────────────────────────────────────────────────
app.get('/api/novels', (req, res) => {
  const novels = readJSON('novels.json', []);
  const search = (req.query.search || '').trim().toLowerCase();
  const genre = req.query.genre || '전체';
  const sort = req.query.sort || 'latest'; // latest, views, likes

  let filtered = novels.map(novel => {
    const eps = novel.episodes || [];
    const totalWords = eps.reduce((acc, ep) => acc + (ep.content ? ep.content.length : 0), 0);
    return {
      id: novel.id,
      title: novel.title,
      author: novel.author,
      genre: novel.genre,
      status: novel.status,
      cover: novel.cover,
      synopsis: novel.synopsis,
      views: novel.views || 0,
      likes: novel.likes || 0,
      episodeCount: eps.length,
      totalWords: totalWords,
      latestEpisode: eps.length > 0 ? {
        id: eps[eps.length - 1].id,
        number: eps[eps.length - 1].episodeNumber,
        title: eps[eps.length - 1].title,
        createdAt: eps[eps.length - 1].createdAt
      } : null,
      createdAt: novel.createdAt
    };
  });

  if (genre !== '전체') {
    filtered = filtered.filter(n => n.genre === genre);
  }

  if (search) {
    filtered = filtered.filter(n => 
      n.title.toLowerCase().includes(search) || 
      n.author.toLowerCase().includes(search) || 
      n.synopsis.toLowerCase().includes(search)
    );
  }

  if (sort === 'views') {
    filtered.sort((a, b) => b.views - a.views);
  } else if (sort === 'likes') {
    filtered.sort((a, b) => b.likes - a.likes);
  } else {
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  res.json({ success: true, novels: filtered });
});

// 소설 상세 정보 조회
app.get('/api/novels/:id', (req, res) => {
  const novels = readJSON('novels.json', []);
  const novel = novels.find(n => n.id === req.params.id);
  if (!novel) return res.status(404).json({ success: false, message: '작품을 찾을 수 없습니다.' });

  // 조회수 증가
  novel.views = (novel.views || 0) + 1;
  writeJSON('novels.json', novels);

  const safeNovel = {
    ...novel,
    password: novel.password ? '***' : undefined,
    episodes: (novel.episodes || []).map(ep => ({
      id: ep.id,
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      wordCount: (ep.content || '').length,
      views: ep.views || 0,
      likes: ep.likes || 0,
      createdAt: ep.createdAt
    }))
  };

  res.json({ success: true, novel: safeNovel });
});

// 신규 소설 등록
app.post('/api/novels', (req, res) => {
  try {
    const { title, author, password, genre, status, cover, synopsis } = req.body;
    if (!title || !author || !password) {
      return res.status(400).json({ success: false, message: '제목, 작가명, 수정 비밀번호는 필수입니다.' });
    }

    const novels = readJSON('novels.json', []);
    const newId = `novel-${Date.now()}`;
    const newNovel = {
      id: newId,
      title: title.trim(),
      author: author.trim(),
      password: password.trim(),
      genre: genre || '판타지',
      status: status || '연재중',
      cover: cover || 'preset-fantasy',
      synopsis: (synopsis || '').trim(),
      views: 1,
      likes: 0,
      createdAt: new Date().toISOString(),
      episodes: []
    };

    novels.unshift(newNovel);
    writeJSON('novels.json', novels);

    // 디스코드 알림
    sendDiscordWebhook({
      username: '소설 스튜디오 알리미',
      embeds: [{
        title: `📚 새 작품 등록! 『${newNovel.title}』`,
        description: `**작가:** ${newNovel.author} | **장르:** ${newNovel.genre}\n**줄거리:** ${newNovel.synopsis.slice(0, 100)}...`,
        color: 0x9B59B6,
        footer: { text: `소설.메인.한국 • 신규 작품 알림` }
      }]
    });

    res.json({ success: true, novelId: newId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 소설 정보 수정
app.put('/api/novels/:id', (req, res) => {
  const novels = readJSON('novels.json', []);
  const novel = novels.find(n => n.id === req.params.id);
  if (!novel) return res.status(404).json({ success: false, message: '작품을 찾을 수 없습니다.' });

  const { title, author, password, genre, status, cover, synopsis } = req.body;
  if (novel.password && novel.password !== password && password !== ADMIN_PASSWORD) {
    return res.status(403).json({ success: false, message: '비밀번호가 일치하지 않습니다.' });
  }

  if (title) novel.title = title.trim();
  if (author) novel.author = author.trim();
  if (genre) novel.genre = genre;
  if (status) novel.status = status;
  if (cover) novel.cover = cover;
  if (synopsis !== undefined) novel.synopsis = synopsis.trim();

  writeJSON('novels.json', novels);
  res.json({ success: true });
});

// 소설 삭제
app.delete('/api/novels/:id', (req, res) => {
  const novels = readJSON('novels.json', []);
  const index = novels.findIndex(n => n.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: '작품을 찾을 수 없습니다.' });

  const password = req.body.password || req.query.password;
  if (novels[index].password && novels[index].password !== password && password !== ADMIN_PASSWORD) {
    return res.status(403).json({ success: false, message: '비밀번호가 일치하지 않습니다.' });
  }

  novels.splice(index, 1);
  writeJSON('novels.json', novels);
  res.json({ success: true });
});

// 소설 추천
app.post('/api/novels/:id/like', (req, res) => {
  const novels = readJSON('novels.json', []);
  const novel = novels.find(n => n.id === req.params.id);
  if (!novel) return res.status(404).json({ success: false, message: '작품을 찾을 수 없습니다.' });

  novel.likes = (novel.likes || 0) + 1;
  writeJSON('novels.json', novels);
  res.json({ success: true, likes: novel.likes });
});

// ─── 3. 회차(에피소드) API ──────────────────────────────────────────
// 회차 본문 조회 (이전화/다음화 ID 계산)
app.get('/api/novels/:novelId/episodes/:episodeId', (req, res) => {
  const novels = readJSON('novels.json', []);
  const novel = novels.find(n => n.id === req.params.novelId);
  if (!novel) return res.status(404).json({ success: false, message: '작품을 찾을 수 없습니다.' });

  const eps = novel.episodes || [];
  const epIndex = eps.findIndex(e => e.id === req.params.episodeId);
  if (epIndex === -1) return res.status(404).json({ success: false, message: '회차를 찾을 수 없습니다.' });

  // 조회수 증가
  eps[epIndex].views = (eps[epIndex].views || 0) + 1;
  writeJSON('novels.json', novels);

  const prevEp = epIndex > 0 ? { id: eps[epIndex - 1].id, number: eps[epIndex - 1].episodeNumber, title: eps[epIndex - 1].title } : null;
  const nextEp = epIndex < eps.length - 1 ? { id: eps[epIndex + 1].id, number: eps[epIndex + 1].episodeNumber, title: eps[epIndex + 1].title } : null;

  res.json({
    success: true,
    novelTitle: novel.title,
    novelAuthor: novel.author,
    episode: eps[epIndex],
    prevEpisode: prevEp,
    nextEpisode: nextEp,
    allEpisodes: eps.map(e => ({ id: e.id, number: e.episodeNumber, title: e.title }))
  });
});

// 신규 회차 등록
app.post('/api/novels/:novelId/episodes', (req, res) => {
  try {
    const novels = readJSON('novels.json', []);
    const novel = novels.find(n => n.id === req.params.novelId);
    if (!novel) return res.status(404).json({ success: false, message: '작품을 찾을 수 없습니다.' });

    const { title, content, authorNote, password } = req.body;
    if (novel.password && novel.password !== password && password !== ADMIN_PASSWORD) {
      return res.status(403).json({ success: false, message: '작가 비밀번호가 일치하지 않습니다.' });
    }

    if (!title || !content) {
      return res.status(400).json({ success: false, message: '회차 제목과 본문은 필수입니다.' });
    }

    if (!novel.episodes) novel.episodes = [];
    const epNumber = novel.episodes.length + 1;
    const newEpisode = {
      id: `ep-${novel.id}-${Date.now()}`,
      episodeNumber: epNumber,
      title: title.trim(),
      content: content.trim(),
      authorNote: (authorNote || '').trim(),
      views: 1,
      likes: 0,
      createdAt: new Date().toISOString()
    };

    novel.episodes.push(newEpisode);
    writeJSON('novels.json', novels);

    // 디스코드 알림
    sendDiscordWebhook({
      username: '소설 스튜디오 연재 알리미',
      embeds: [{
        title: `📖 새 회차 연재! 『${novel.title}』 ${newEpisode.title}`,
        description: `**글자수:** ${newEpisode.content.length.toLocaleString()}자 | **회차:** 제${epNumber}화`,
        color: 0x2ECC71,
        footer: { text: `소설.메인.한국 • 최신 회차 업로드` }
      }]
    });

    res.json({ success: true, episodeId: newEpisode.id, episodeNumber: epNumber });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 회차 수정
app.put('/api/novels/:novelId/episodes/:episodeId', (req, res) => {
  const novels = readJSON('novels.json', []);
  const novel = novels.find(n => n.id === req.params.novelId);
  if (!novel) return res.status(404).json({ success: false, message: '작품을 찾을 수 없습니다.' });

  const { title, content, authorNote, password } = req.body;
  if (novel.password && novel.password !== password && password !== ADMIN_PASSWORD) {
    return res.status(403).json({ success: false, message: '작가 비밀번호가 일치하지 않습니다.' });
  }

  const ep = (novel.episodes || []).find(e => e.id === req.params.episodeId);
  if (!ep) return res.status(404).json({ success: false, message: '회차를 찾을 수 없습니다.' });

  if (title) ep.title = title.trim();
  if (content) ep.content = content.trim();
  if (authorNote !== undefined) ep.authorNote = authorNote.trim();

  writeJSON('novels.json', novels);
  res.json({ success: true });
});

// 회차 삭제
app.delete('/api/novels/:novelId/episodes/:episodeId', (req, res) => {
  const novels = readJSON('novels.json', []);
  const novel = novels.find(n => n.id === req.params.novelId);
  if (!novel) return res.status(404).json({ success: false, message: '작품을 찾을 수 없습니다.' });

  const password = req.body.password || req.query.password;
  if (novel.password && novel.password !== password && password !== ADMIN_PASSWORD) {
    return res.status(403).json({ success: false, message: '작가 비밀번호가 일치하지 않습니다.' });
  }

  const epIndex = (novel.episodes || []).findIndex(e => e.id === req.params.episodeId);
  if (epIndex === -1) return res.status(404).json({ success: false, message: '회차를 찾을 수 없습니다.' });

  novel.episodes.splice(epIndex, 1);
  // 번호 재정렬
  novel.episodes.forEach((ep, idx) => { ep.episodeNumber = idx + 1; });
  writeJSON('novels.json', novels);
  res.json({ success: true });
});

// 회차 추천
app.post('/api/novels/:novelId/episodes/:episodeId/like', (req, res) => {
  const novels = readJSON('novels.json', []);
  const novel = novels.find(n => n.id === req.params.novelId);
  if (!novel) return res.status(404).json({ success: false, message: '작품을 찾을 수 없습니다.' });

  const ep = (novel.episodes || []).find(e => e.id === req.params.episodeId);
  if (!ep) return res.status(404).json({ success: false, message: '회차를 찾을 수 없습니다.' });

  ep.likes = (ep.likes || 0) + 1;
  novel.likes = (novel.likes || 0) + 1;
  writeJSON('novels.json', novels);
  res.json({ success: true, likes: ep.likes });
});

// ─── 4. 댓글 API ───────────────────────────────────────────────────
app.get('/api/comments', (req, res) => {
  const { novelId, episodeId } = req.query;
  const comments = readJSON('comments.json', []);
  let filtered = comments;
  if (novelId) filtered = filtered.filter(c => c.novelId === novelId);
  if (episodeId) filtered = filtered.filter(c => c.episodeId === episodeId);
  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, comments: filtered });
});

app.post('/api/comments', (req, res) => {
  const { novelId, episodeId, author, content } = req.body;
  if (!novelId || !episodeId || !content) {
    return res.status(400).json({ success: false, message: '내용을 입력해 주세요.' });
  }

  const comments = readJSON('comments.json', []);
  const newComment = {
    id: `comm-${Date.now()}`,
    novelId,
    episodeId,
    author: (author || '독자').trim().slice(0, 15),
    content: content.trim().slice(0, 500),
    likes: 0,
    createdAt: new Date().toISOString()
  };

  comments.unshift(newComment);
  writeJSON('comments.json', comments);
  res.json({ success: true, comment: newComment });
});

app.post('/api/comments/:id/like', (req, res) => {
  const comments = readJSON('comments.json', []);
  const c = comments.find(item => item.id === req.params.id);
  if (!c) return res.status(404).json({ success: false, message: '댓글을 찾을 수 없습니다.' });
  c.likes = (c.likes || 0) + 1;
  writeJSON('comments.json', comments);
  res.json({ success: true, likes: c.likes });
});

// ─── 5. 간편 회원가입 API (1인 1휴대폰 즉시 등록) ──────────────────
app.post('/api/members/register', (req, res) => {
  try {
    const { phone, nickname, carrier, email, ageGroup, gender, interests, marketingConsent } = req.body;
    if (!phone || !nickname) {
      return res.status(400).json({ success: false, message: '휴대폰 번호와 닉네임은 필수입니다.' });
    }

    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ success: false, message: '올바른 휴대폰 번호를 입력해 주세요.' });
    }

    const formattedPhone = cleanPhone.replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3');
    const members = readJSON('members.json', []);

    let existing = members.find(m => m.phone === formattedPhone);
    const ip = getClientIp(req);

    if (existing) {
      // 기존 회원 갱신
      existing.nickname = nickname.trim();
      if (email) existing.email = email.trim();
      if (carrier) existing.carrier = carrier;
      if (ageGroup) existing.ageGroup = ageGroup;
      if (gender) existing.gender = gender;
      if (interests) existing.interests = interests;
      if (marketingConsent !== undefined) existing.marketingConsent = marketingConsent;
      existing.lastLoginAt = new Date().toISOString();
      writeJSON('members.json', members);
      return res.json({ success: true, message: '회원 정보가 확인되었습니다.', member: existing });
    }

    const newMember = {
      id: `mem-${Date.now()}`,
      phone: formattedPhone,
      nickname: nickname.trim(),
      carrier: carrier || '알뜰폰/기타',
      email: email ? email.trim() : '',
      ageGroup: ageGroup || '20대',
      gender: gender || '미선택',
      interests: interests || '웹소설 독서',
      marketingConsent: Boolean(marketingConsent),
      createdAt: new Date().toISOString(),
      ip: ip
    };

    members.unshift(newMember);
    writeJSON('members.json', members);

    // 디스코드 가입 알림
    sendDiscordWebhook({
      username: '소설 스튜디오 회원 봇',
      embeds: [{
        title: `🎉 신규 회원 즉시 가입 완료!`,
        description: `**닉네임:** \`${newMember.nickname}\`\n**연락처:** \`${newMember.phone}\` (${newMember.carrier})\n**이메일:** \`${newMember.email || '미입력'}\`\n**연령/성별:** \`${newMember.ageGroup} / ${newMember.gender}\`\n**관심장르:** \`${newMember.interests}\`\n**마케팅수신동의:** \`${newMember.marketingConsent ? '동의 (수집가능)' : '미동의'}\``,
        color: 0xF1C40F,
        footer: { text: `소설.메인.한국 • 회원 빅데이터 수집` }
      }]
    });

    res.json({ success: true, message: '정상적으로 가입되었습니다!', member: newMember });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── 6. 텍스트(.txt) 소설 내보내기/소장 다운로드 API ──────────────
app.get('/api/novels/:novelId/export', (req, res) => {
  const novels = readJSON('novels.json', []);
  const novel = novels.find(n => n.id === req.params.novelId);
  if (!novel) return res.status(404).send('작품을 찾을 수 없습니다.');

  const episodeId = req.query.episodeId;
  let text = '';
  let filename = `${novel.title.replace(/[\\/:*?"<>|]/g, '_')}`;

  if (episodeId) {
    const ep = (novel.episodes || []).find(e => e.id === episodeId);
    if (!ep) return res.status(404).send('회차를 찾을 수 없습니다.');
    filename += `_${ep.title.replace(/[\\/:*?"<>|]/g, '_')}.txt`;
    text = `=========================================\r\n` +
           `작품명: ${novel.title}\r\n` +
           `회차명: ${ep.title}\r\n` +
           `작가명: ${novel.author}\r\n` +
           `보관처: ${SERVICE_DOMAIN}\r\n` +
           `=========================================\r\n\r\n` +
           `${ep.content}\r\n\r\n` +
           (ep.authorNote ? `[작가의 말]\r\n${ep.authorNote}\r\n` : '');
  } else {
    filename += `_전체회차소장용.txt`;
    text = `=========================================\r\n` +
           `작품명: ${novel.title}\r\n` +
           `작가명: ${novel.author} | 장르: ${novel.genre}\r\n` +
           `줄거리: ${novel.synopsis}\r\n` +
           `보관처: ${SERVICE_DOMAIN}\r\n` +
           `총 회차: ${(novel.episodes || []).length}화\r\n` +
           `=========================================\r\n\r\n`;

    (novel.episodes || []).forEach(ep => {
      text += `\r\n\r\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n` +
              `▶ ${ep.title}\r\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n\r\n` +
              `${ep.content}\r\n\r\n` +
              (ep.authorNote ? `[작가의 말] ${ep.authorNote}\r\n` : '');
    });
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(text);
});

// ─── 7. 최고 관리자 빅데이터 대시보드 API ──────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { id, password } = req.body;
  if (id === ADMIN_ID && password === ADMIN_PASSWORD) {
    res.json({ success: true, token: 'admin-authorized-token' });
  } else {
    res.status(401).json({ success: false, message: '관리자 아이디 또는 비밀번호가 틀립니다.' });
  }
});

app.get('/api/admin/stats', (req, res) => {
  const members = readJSON('members.json', []);
  const novels = readJSON('novels.json', []);
  const visitors = readJSON('visitors.json', []);
  const comments = readJSON('comments.json', []);

  const totalEpisodes = novels.reduce((acc, n) => acc + (n.episodes || []).length, 0);
  const totalViews = novels.reduce((acc, n) => acc + (n.views || 0), 0);
  const totalWords = novels.reduce((acc, n) => {
    return acc + (n.episodes || []).reduce((eAcc, ep) => eAcc + (ep.content ? ep.content.length : 0), 0);
  }, 0);

  res.json({
    success: true,
    stats: {
      totalMembers: members.length,
      totalNovels: novels.length,
      totalEpisodes: totalEpisodes,
      totalViews: totalViews,
      totalWords: totalWords,
      totalComments: comments.length,
      totalVisitors: visitors.length
    },
    members: members.slice(0, 100),
    novels: novels.map(n => ({
      id: n.id,
      title: n.title,
      author: n.author,
      genre: n.genre,
      status: n.status,
      episodesCount: (n.episodes || []).length,
      views: n.views || 0,
      likes: n.likes || 0,
      createdAt: n.createdAt
    })),
    recentVisitors: visitors.slice(0, 50)
  });
});

// 관리자 회원 엑셀(CSV UTF-8 BOM) 다운로드
app.get('/api/admin/export-members', (req, res) => {
  const members = readJSON('members.json', []);
  let csv = '\uFEFF'; // UTF-8 BOM
  csv += 'ID,휴대폰번호,닉네임,통신사,이메일,연령대,성별,관심사,마케팅동의여부,가입일시,가입IP\r\n';

  members.forEach(m => {
    const row = [
      m.id || '',
      m.phone || '',
      `"${(m.nickname || '').replace(/"/g, '""')}"`,
      m.carrier || '',
      m.email || '',
      m.ageGroup || '',
      m.gender || '',
      `"${(m.interests || '').replace(/"/g, '""')}"`,
      m.marketingConsent ? '동의' : '미동의',
      m.createdAt || '',
      m.ip || ''
    ];
    csv += row.join(',') + '\r\n';
  });

  const filename = `소설_회원빅데이터_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(csv);
});

// 관리자 소설 및 회차 엑셀(CSV UTF-8 BOM) 다운로드
app.get('/api/admin/export-novels', (req, res) => {
  const novels = readJSON('novels.json', []);
  let csv = '\uFEFF'; // UTF-8 BOM
  csv += '작품ID,작품명,작가명,장르,연재상태,총회차수,누적조회수,누적추천수,총글자수,등록일시\r\n';

  novels.forEach(n => {
    const eps = n.episodes || [];
    const totalWords = eps.reduce((acc, ep) => acc + (ep.content ? ep.content.length : 0), 0);
    const row = [
      n.id,
      `"${(n.title || '').replace(/"/g, '""')}"`,
      `"${(n.author || '').replace(/"/g, '""')}"`,
      n.genre || '',
      n.status || '',
      eps.length,
      n.views || 0,
      n.likes || 0,
      totalWords,
      n.createdAt || ''
    ];
    csv += row.join(',') + '\r\n';
  });

  const filename = `소설_작품목록_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(csv);
});

// ─── 8. 헬스 체크 & 도메인 감지 ────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Novel Archive Studio',
    domain: SERVICE_DOMAIN,
    punycode: process.env.SERVICE_PUNYCODE || 'xn--9t4b11e.xn--f12ba.xn--3e0b707e',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// SPA 라우트 폴백
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 실행
app.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(`📖 소설 아카이브 스튜디오 서버 정상 가동!`);
  console.log(`🌐 서비스 도메인: http://${HOST}:${PORT}`);
  console.log(`🔗 연결 도메인: ${SERVICE_DOMAIN} (${process.env.SERVICE_PUNYCODE})`);
  console.log(`🛡️ 최고 관리자 계정: ${ADMIN_ID}`);
  console.log(`=======================================================`);
});
