/* ══════════════════════════════════════════════════════════════════
   소설 아카이브 스튜디오 (Novel Archive Studio) - script.js
   32가지 소설 특화 기능, 뷰어 테마/폰트, TTS 오디오북, 앰비언스 BGM,
   텔레메트리 & 디스코드 실시간 웹훅, 최고 관리자 빅데이터 관제탑
   ══════════════════════════════════════════════════════════════════ */

// ─── 전역 상태 변수 ──────────────────────────────────────────────
const APP_STATE = {
  currentView: 'home',
  novels: [],
  selectedNovel: null,
  currentEpisode: null,
  currentNovelId: null,
  currentEpisodeId: null,
  episodesSortOrder: 'asc',
  member: null,
  adminToken: null,
  selectedCoverPreset: 'preset-fantasy',
  readerSettings: {
    theme: 'theme-light',
    font: 'font-serif',
    fontSize: 18,
    lineHeight: 1.9,
    width: 'w-normal'
  },
  tts: {
    isPlaying: false,
    synth: window.speechSynthesis || null,
    utterance: null
  },
  bgm: {
    activeSound: null,
    audioCtx: null,
    gainNode: null,
    volume: 0.5,
    sourceNodes: []
  }
};

// ─── 초기화 ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSavedPreferences();
  initTelemetry();
  checkDomain();
  fetchNovels();
  setupKeyboardShortcuts();
  setupScrollProgress();
  setupAutoSave();
});

// 로컬스토리지 설정 복원
function loadSavedPreferences() {
  try {
    const savedReader = localStorage.getItem('novel_reader_settings');
    if (savedReader) {
      APP_STATE.readerSettings = { ...APP_STATE.readerSettings, ...JSON.parse(savedReader) };
      applyReaderSettings();
    }
    const savedMember = localStorage.getItem('novel_member');
    if (savedMember) {
      APP_STATE.member = JSON.parse(savedMember);
      updateMemberUI();
    }
    const savedAdmin = sessionStorage.getItem('novel_admin_token');
    if (savedAdmin) {
      APP_STATE.adminToken = savedAdmin;
    }
  } catch (e) {
    console.warn('설정 복원 에러:', e);
  }
}

// ─── 1. 방문자 텔레메트리 & 기기 스펙 수집 ───────────────────────
function initTelemetry() {
  try {
    let vid = localStorage.getItem('moa_vid');
    let visitCount = parseInt(localStorage.getItem('novel_visit_count') || '0', 10) + 1;
    localStorage.setItem('novel_visit_count', visitCount.toString());

    if (!vid) {
      vid = 'vid-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
      localStorage.setItem('moa_vid', vid);
    }

    let sessionId = sessionStorage.getItem('novel_session_id');
    if (!sessionId) {
      sessionId = 'sess-' + Math.random().toString(36).substring(2, 9);
      sessionStorage.setItem('novel_session_id', sessionId);
    }

    // WebGL GPU Renderer 감지
    let gpu = 'Unknown GPU';
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          gpu = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        }
      }
    } catch (e) {}

    // 통신망 & 네트워크 감지
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const connectionInfo = conn ? `${conn.effectiveType || '4g'} (${conn.downlink || '?'}Mbps, RTT ${conn.rtt || '?'}ms)` : 'N/A';

    // 화면 및 하드웨어
    const screenRes = `${window.screen.width}x${window.screen.height}`;
    const viewportRes = `${window.innerWidth}x${window.innerHeight}`;
    const dpr = window.devicePixelRatio || 1;
    const cores = navigator.hardwareConcurrency || 'N/A';
    const memory = navigator.deviceMemory || 'N/A';
    const touchPoints = navigator.maxTouchPoints || 0;

    // 유입 채널 분석
    const ref = document.referrer || '';
    let channel = '웹포워딩 / 직접접속';
    if (ref.includes('kakaotalk') || navigator.userAgent.includes('KAKAOTALK')) channel = '카카오톡 인앱';
    else if (ref.includes('instagram') || navigator.userAgent.includes('Instagram')) channel = '인스타그램 인앱';
    else if (ref.includes('naver') || navigator.userAgent.includes('NAVER')) channel = '네이버 포털';
    else if (ref.includes('google')) channel = '구글 검색';
    else if (ref) channel = `외부 링크 (${new URL(ref).hostname})`;

    // 서버로 전송
    fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vid,
        visitCount,
        sessionId,
        gpu,
        cores,
        memory,
        touchPoints,
        screen: screenRes,
        viewport: viewportRes,
        dpr,
        connection: connectionInfo,
        referrer: ref || '직접 방문',
        channel,
        currentHost: window.location.hostname,
        currentUrl: window.location.href
      })
    }).catch(() => {});
  } catch (e) {
    console.warn('텔레메트리 수집 예외:', e);
  }
}

// ─── 2. 도메인 웹포워딩 감지 & 웰컴 배너 ──────────────────────────
function checkDomain() {
  const host = window.location.hostname;
  const isPuny = host.includes('xn--');
  const isNovelMain = host.includes('소설.메인.한국') || isPuny;
  const banner = document.getElementById('domain-banner');
  if (banner && (isNovelMain || host === 'localhost' || host === '127.0.0.1')) {
    banner.style.display = 'block';
  }
}

function closeDomainBanner() {
  const banner = document.getElementById('domain-banner');
  if (banner) banner.style.display = 'none';
}

// ─── 3. SPA 네비게이션 ───────────────────────────────────────────
function navigate(viewName, params = {}) {
  APP_STATE.currentView = viewName;
  document.querySelectorAll('.spa-view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) targetView.classList.add('active');

  const targetNavBtn = document.querySelector(`.nav-btn[data-view="${viewName}"]`);
  if (targetNavBtn) targetNavBtn.classList.add('active');

  // 리더 뷰가 아닐 때는 프로그레스 바 숨김
  const progressBar = document.getElementById('reader-progress-bar');
  if (viewName !== 'reader') {
    progressBar.style.width = '0%';
    stopTTS();
  }

  // 뷰별 데이터 로드
  if (viewName === 'home') {
    fetchNovels();
  } else if (viewName === 'library') {
    renderLibraryView();
  } else if (viewName === 'studio') {
    populateStudioNovels();
    updateStudioStats();
  } else if (viewName === 'admin') {
    if (!APP_STATE.adminToken) {
      openAdminModal();
    } else {
      loadAdminDashboard();
    }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleMobileNav() {
  const menu = document.getElementById('mobile-nav-dropdown');
  menu.classList.toggle('hidden');
}

// ─── 4. 소설 목록 조회 및 렌더링 ─────────────────────────────────
let activeGenre = '전체';
let currentSearch = '';
let currentSort = 'latest';

async function fetchNovels() {
  try {
    const url = `/api/novels?genre=${encodeURIComponent(activeGenre)}&search=${encodeURIComponent(currentSearch)}&sort=${currentSort}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.success) {
      APP_STATE.novels = data.novels;
      renderNovelsGrid(data.novels);
      updateHeroStats(data.novels);
    }
  } catch (e) {
    console.error('소설 목록 로드 실패:', e);
  }
}

function renderNovelsGrid(novels) {
  const container = document.getElementById('novels-grid');
  if (!container) return;

  if (novels.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; background: #fff; border-radius: 16px; border: 1px dashed #cbd5e1;">
        <i class="fa-solid fa-book-open" style="font-size: 3rem; color: #94a3b8; margin-bottom: 12px;"></i>
        <h3 style="color: #475569; margin-bottom: 8px;">해당 조건의 소설이 없습니다.</h3>
        <p style="color: #94a3b8; margin-bottom: 16px;">첫 번째 소설의 작가가 되어보세요!</p>
        <button class="btn-primary" onclick="navigate('studio')"><i class="fa-solid fa-feather"></i> 새 작품 등록하기</button>
      </div>
    `;
    return;
  }

  container.innerHTML = novels.map(novel => {
    return `
      <div class="novel-card">
        <div class="novel-cover ${novel.cover || 'preset-fantasy'}">
          <span class="cover-badge-genre">${novel.genre}</span>
          <span class="cover-badge-status">${novel.status || '연재중'}</span>
          <div class="cover-title-overlay">${escapeHtml(novel.title)}</div>
        </div>
        <div class="novel-card-body">
          <div class="nc-author"><i class="fa-solid fa-pen-nib"></i> ${escapeHtml(novel.author)}</div>
          <div class="nc-synopsis">${escapeHtml(novel.synopsis || '등록된 줄거리가 없습니다.')}</div>
          <div class="nc-meta-counts">
            <span><i class="fa-solid fa-layer-group"></i> ${novel.episodeCount || 0}화</span>
            <span><i class="fa-solid fa-eye"></i> ${(novel.views || 0).toLocaleString()}</span>
            <span><i class="fa-solid fa-heart"></i> ${(novel.likes || 0).toLocaleString()}</span>
            <span><i class="fa-solid fa-font"></i> ${(novel.totalWords || 0).toLocaleString()}자</span>
          </div>
          <div class="nc-actions">
            <button class="btn-card-binge" onclick="bingeFirstEpisode('${novel.id}')">
              <i class="fa-solid fa-play"></i> 1화 정주행
            </button>
            <button class="btn-card-detail" onclick="openNovelDetail('${novel.id}')">
              작품 정보
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// 히어로 실시간 지표 갱신
function updateHeroStats(novels) {
  const totalNovels = novels.length;
  const totalEps = novels.reduce((acc, n) => acc + (n.episodeCount || 0), 0);
  const totalViews = novels.reduce((acc, n) => acc + (n.views || 0), 0);
  const totalWords = novels.reduce((acc, n) => acc + (n.totalWords || 0), 0);

  const elNovels = document.getElementById('stat-total-novels');
  const elEps = document.getElementById('stat-total-episodes');
  const elViews = document.getElementById('stat-total-views');
  const elWords = document.getElementById('stat-total-words');

  if (elNovels) elNovels.textContent = totalNovels.toLocaleString();
  if (elEps) elEps.textContent = totalEps.toLocaleString() + '화';
  if (elViews) elViews.textContent = totalViews.toLocaleString();
  if (elWords) elWords.textContent = (totalWords > 10000 ? (totalWords / 10000).toFixed(1) + '만자' : totalWords.toLocaleString() + '자');
}

// 장르 필터 탭 클릭
document.querySelectorAll('.genre-tab').forEach(tab => {
  tab.addEventListener('click', (e) => {
    document.querySelectorAll('.genre-tab').forEach(t => t.classList.remove('active'));
    e.currentTarget.classList.add('active');
    activeGenre = e.currentTarget.dataset.genre;
    fetchNovels();
  });
});

function onSearchChange() {
  currentSearch = document.getElementById('novel-search-input').value;
  fetchNovels();
}

function onSortChange() {
  currentSort = document.getElementById('novel-sort-select').value;
  fetchNovels();
}

function scrollToNovels() {
  const target = document.getElementById('novels-catalog-section');
  if (target) target.scrollIntoView({ behavior: 'smooth' });
}

// ─── 5. 작품 상세 뷰 (NOVEL DETAIL) ──────────────────────────────
async function openNovelDetail(novelId) {
  try {
    const res = await fetch(`/api/novels/${novelId}`);
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || '작품 정보를 불러올 수 없습니다.');
      return;
    }

    APP_STATE.selectedNovel = data.novel;
    renderNovelDetail(data.novel);
    navigate('detail');
  } catch (e) {
    showToast('작품을 불러오는 중 오류가 발생했습니다.');
  }
}

function renderNovelDetail(novel) {
  const card = document.getElementById('novel-detail-card');
  const epsCount = document.getElementById('detail-episodes-count');
  epsCount.textContent = (novel.episodes || []).length;

  const totalWords = (novel.episodes || []).reduce((acc, ep) => acc + (ep.wordCount || 0), 0);
  const firstEp = (novel.episodes && novel.episodes.length > 0) ? novel.episodes[0] : null;

  card.innerHTML = `
    <div class="nd-top-layout">
      <div class="nd-cover-box ${novel.cover || 'preset-fantasy'}">
        <span class="cover-badge-status">${novel.status || '연재중'}</span>
      </div>
      <div class="nd-info">
        <span class="nd-genre-tag">${novel.genre}</span>
        <h1 class="nd-title">${escapeHtml(novel.title)}</h1>
        <div class="nd-author-line"><i class="fa-solid fa-pen-nib"></i> 작가: <strong>${escapeHtml(novel.author)}</strong></div>
        <div class="nd-stats-row">
          <span><i class="fa-solid fa-layer-group"></i> 총 <strong>${(novel.episodes || []).length}</strong>화</span>
          <span><i class="fa-solid fa-eye"></i> 조회 <strong>${(novel.views || 0).toLocaleString()}</strong></span>
          <span><i class="fa-solid fa-heart"></i> 추천 <strong>${(novel.likes || 0).toLocaleString()}</strong></span>
          <span><i class="fa-solid fa-font"></i> 글자수 <strong>${totalWords.toLocaleString()}</strong>자</span>
        </div>
        <div class="nd-synopsis-box">
          ${escapeHtml(novel.synopsis || '등록된 줄거리가 없습니다.')}
        </div>
      </div>
    </div>

    <!-- 대형 액션 버튼들 -->
    <div class="nd-action-buttons">
      ${firstEp ? `
        <button class="btn-binge-lg" onclick="openReader('${novel.id}', '${firstEp.id}')">
          <i class="fa-solid fa-play"></i> 1화부터 첫편 정주행
        </button>
      ` : `
        <button class="btn-binge-lg" disabled style="opacity: 0.6;">
          <i class="fa-solid fa-hourglass-start"></i> 연재 준비 중
        </button>
      `}
      <button class="btn-detail-action" onclick="toggleBookmark('${novel.id}')">
        <i class="fa-solid fa-bookmark"></i> 내 서재 담기
      </button>
      <button class="btn-detail-action" onclick="likeNovel('${novel.id}')">
        <i class="fa-solid fa-heart"></i> 작품 추천
      </button>
      <button class="btn-detail-action" onclick="writeNextEpisodeForNovel('${novel.id}')">
        <i class="fa-solid fa-pen"></i> 다음화 집필
      </button>
      <button class="btn-detail-action" onclick="downloadNovelTxt('${novel.id}')">
        <i class="fa-solid fa-download"></i> 전편 소장 .txt
      </button>
      <button class="btn-detail-action" onclick="openShareModal()">
        <i class="fa-solid fa-share-nodes"></i> 공유
      </button>
    </div>
  `;

  renderEpisodesList(novel.episodes || []);
}

function setEpisodesSort(order) {
  APP_STATE.episodesSortOrder = order;
  document.getElementById('btn-sort-asc').classList.toggle('active', order === 'asc');
  document.getElementById('btn-sort-desc').classList.toggle('active', order === 'desc');

  if (APP_STATE.selectedNovel && APP_STATE.selectedNovel.episodes) {
    renderEpisodesList(APP_STATE.selectedNovel.episodes);
  }
}

function renderEpisodesList(episodes) {
  const listContainer = document.getElementById('detail-episodes-list');
  if (!episodes || episodes.length === 0) {
    listContainer.innerHTML = `<div style="text-align: center; padding: 30px; color: #94a3b8;">아직 연재된 회차가 없습니다.</div>`;
    return;
  }

  const sorted = [...episodes].sort((a, b) => {
    return APP_STATE.episodesSortOrder === 'asc' ? a.episodeNumber - b.episodeNumber : b.episodeNumber - a.episodeNumber;
  });

  listContainer.innerHTML = sorted.map(ep => {
    const formattedDate = (ep.createdAt || '').slice(0, 10);
    return `
      <div class="episode-item" onclick="openReader('${APP_STATE.selectedNovel.id}', '${ep.id}')">
        <div class="ei-left">
          <span class="ei-title">${escapeHtml(ep.title)}</span>
        </div>
        <div class="ei-meta">
          <span><i class="fa-solid fa-font"></i> ${(ep.wordCount || 0).toLocaleString()}자</span>
          <span><i class="fa-solid fa-eye"></i> ${ep.views || 0}</span>
          <span><i class="fa-regular fa-clock"></i> ${formattedDate}</span>
          <i class="fa-solid fa-chevron-right" style="color: #cbd5e1;"></i>
        </div>
      </div>
    `;
  }).join('');
}

// 1화 정주행 바로가기
async function bingeFirstEpisode(novelId) {
  try {
    const res = await fetch(`/api/novels/${novelId}`);
    const data = await res.json();
    if (data.success && data.novel && data.novel.episodes && data.novel.episodes.length > 0) {
      APP_STATE.selectedNovel = data.novel;
      openReader(novelId, data.novel.episodes[0].id);
    } else {
      showToast('아직 등록된 회차가 없습니다. 스튜디오에서 첫 화를 등록해 보세요!');
      navigate('detail');
    }
  } catch (e) {
    showToast('소설 정보를 불러오는 중 오류가 발생했습니다.');
  }
}

// 작품 추천
async function likeNovel(novelId) {
  try {
    const res = await fetch(`/api/novels/${novelId}/like`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`💖 작품을 추천했습니다! (총 ${data.likes}추천)`);
      if (APP_STATE.selectedNovel && APP_STATE.selectedNovel.id === novelId) {
        APP_STATE.selectedNovel.likes = data.likes;
        openNovelDetail(novelId);
      }
    }
  } catch (e) {
    showToast('추천 처리 중 오류가 발생했습니다.');
  }
}

// ─── 6. 몰입형 소설 리더 (READER) ─────────────────────────────────
async function openReader(novelId, episodeId) {
  try {
    APP_STATE.currentNovelId = novelId;
    APP_STATE.currentEpisodeId = episodeId;

    const res = await fetch(`/api/novels/${novelId}/episodes/${episodeId}`);
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || '회차를 불러올 수 없습니다.');
      return;
    }

    APP_STATE.currentEpisode = data;
    renderReader(data);
    navigate('reader');

    // 서재에 독서 이력 저장
    saveReadingHistory(novelId, data.novelTitle, episodeId, data.episode.title, data.episode.episodeNumber);

    // 댓글 목록 불러오기
    fetchComments(novelId, episodeId);
  } catch (e) {
    showToast('회차 본문을 불러오는 중 오류가 발생했습니다.');
  }
}

function renderReader(data) {
  const ep = data.episode;
  document.getElementById('rf-novel-title').textContent = data.novelTitle;
  document.getElementById('rf-ep-title').textContent = ep.title;
  document.getElementById('rm-novel-name').textContent = data.novelTitle;
  document.getElementById('rm-ep-name').textContent = ep.title;
  document.getElementById('rm-author').innerHTML = `<i class="fa-solid fa-pen-nib"></i> ${escapeHtml(data.novelAuthor || '작가')}`;
  document.getElementById('rm-date').innerHTML = `<i class="fa-regular fa-clock"></i> ${(ep.createdAt || '').slice(0, 10)}`;

  const charCount = (ep.content || '').length;
  document.getElementById('rm-char-count').innerHTML = `<i class="fa-solid fa-font"></i> ${charCount.toLocaleString()}자`;

  // 예상 독서 시간 (분당 600자 기준)
  const readMins = Math.max(1, Math.round(charCount / 600));
  document.getElementById('rm-read-time').innerHTML = `<i class="fa-solid fa-stopwatch"></i> 약 ${readMins}분`;

  // 본문 문단 분리 렌더링
  const article = document.getElementById('reader-article');
  const paragraphs = (ep.content || '').split('\n').filter(p => p.trim().length > 0);
  article.innerHTML = paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('');

  // 작가의 말
  const noteCard = document.getElementById('author-note-card');
  const noteBody = document.getElementById('anc-body');
  if (ep.authorNote && ep.authorNote.trim()) {
    noteBody.textContent = ep.authorNote;
    noteCard.style.display = 'block';
  } else {
    noteCard.style.display = 'none';
  }

  // 회차 추천수
  document.getElementById('ep-likes-count').textContent = ep.likes || 0;

  // 이전화 / 다음화 버튼 제어
  const btnPrev = document.getElementById('btn-nav-prev');
  const btnNext = document.getElementById('btn-nav-next');

  if (data.prevEpisode) {
    btnPrev.disabled = false;
    btnPrev.style.opacity = '1';
    btnPrev.onclick = () => openReader(APP_STATE.currentNovelId, data.prevEpisode.id);
  } else {
    btnPrev.disabled = true;
    btnPrev.style.opacity = '0.4';
    btnPrev.onclick = null;
  }

  if (data.nextEpisode) {
    btnNext.disabled = false;
    btnNext.style.opacity = '1';
    btnNext.onclick = () => openReader(APP_STATE.currentNovelId, data.nextEpisode.id);
  } else {
    btnNext.disabled = true;
    btnNext.style.opacity = '0.4';
    btnNext.onclick = null;
  }

  // 목차 모달 데이터 준비
  renderTocModal(data.allEpisodes || []);

  // 상단 스크롤 초기화
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function exitReader() {
  stopTTS();
  if (APP_STATE.currentNovelId) {
    openNovelDetail(APP_STATE.currentNovelId);
  } else {
    navigate('home');
  }
}

function goToPrevEpisode() {
  if (APP_STATE.currentEpisode && APP_STATE.currentEpisode.prevEpisode) {
    openReader(APP_STATE.currentNovelId, APP_STATE.currentEpisode.prevEpisode.id);
  } else {
    showToast('첫 번째 회차입니다.');
  }
}

function goToNextEpisode() {
  if (APP_STATE.currentEpisode && APP_STATE.currentEpisode.nextEpisode) {
    openReader(APP_STATE.currentNovelId, APP_STATE.currentEpisode.nextEpisode.id);
  } else {
    showToast('마지막 최신 회차입니다.');
  }
}

// 회차 추천
async function likeCurrentEpisode() {
  if (!APP_STATE.currentNovelId || !APP_STATE.currentEpisodeId) return;
  try {
    const res = await fetch(`/api/novels/${APP_STATE.currentNovelId}/episodes/${APP_STATE.currentEpisodeId}/like`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      document.getElementById('ep-likes-count').textContent = data.likes;
      showToast(`💖 이 회차를 추천했습니다! (${data.likes})`);
    }
  } catch (e) {
    showToast('추천 처리 실패');
  }
}

// ─── 7. 리더 뷰어 설정 (테마, 폰트, 글자 크기, 가로폭) ───────────
function toggleReaderSettings() {
  const panel = document.getElementById('reader-settings-panel');
  panel.classList.toggle('hidden');
}

function setReaderTheme(themeName) {
  APP_STATE.readerSettings.theme = themeName;
  document.body.className = `${themeName} ${APP_STATE.readerSettings.font}`;
  document.querySelectorAll('.theme-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.theme === themeName);
  });
  saveReaderSettings();
}

function setReaderFont(fontName) {
  APP_STATE.readerSettings.font = fontName;
  const wrapper = document.getElementById('reader-wrapper');
  wrapper.className = `reader-wrapper ${fontName} ${APP_STATE.readerSettings.width}`;
  document.querySelectorAll('.font-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.font === fontName);
  });
  saveReaderSettings();
}

function setReaderWidth(widthClass) {
  APP_STATE.readerSettings.width = widthClass;
  const wrapper = document.getElementById('reader-wrapper');
  wrapper.className = `reader-wrapper ${APP_STATE.readerSettings.font} ${widthClass}`;
  document.querySelectorAll('.width-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.width === widthClass);
  });
  saveReaderSettings();
}

function onFontSizeInput(val) {
  APP_STATE.readerSettings.fontSize = parseInt(val, 10);
  applyTypography();
}

function adjustFontSize(delta) {
  const slider = document.getElementById('range-font-size');
  let current = parseInt(slider.value, 10) + delta;
  if (current >= 14 && current <= 28) {
    slider.value = current;
    onFontSizeInput(current);
  }
}

function onLineHeightInput(val) {
  APP_STATE.readerSettings.lineHeight = parseFloat(val);
  applyTypography();
}

function applyTypography() {
  const { fontSize, lineHeight } = APP_STATE.readerSettings;
  const article = document.getElementById('reader-article');
  if (article) {
    article.style.fontSize = `${fontSize}px`;
    article.style.lineHeight = `${lineHeight}`;
  }
  const valFont = document.getElementById('val-font-size');
  const valLine = document.getElementById('val-line-height');
  if (valFont) valFont.textContent = `${fontSize}px`;
  if (valLine) valLine.textContent = `${lineHeight}배`;
  saveReaderSettings();
}

function applyReaderSettings() {
  const { theme, font, fontSize, lineHeight, width } = APP_STATE.readerSettings;
  setReaderTheme(theme);
  setReaderFont(font);
  setReaderWidth(width);
  const sliderFont = document.getElementById('range-font-size');
  const sliderLine = document.getElementById('range-line-height');
  if (sliderFont) sliderFont.value = fontSize;
  if (sliderLine) sliderLine.value = lineHeight;
  applyTypography();
}

function saveReaderSettings() {
  localStorage.setItem('novel_reader_settings', JSON.stringify(APP_STATE.readerSettings));
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

// ─── 8. 상단 독서 진행률 게이지 & 스크롤 감지 ───────────────────
function setupScrollProgress() {
  window.addEventListener('scroll', () => {
    if (APP_STATE.currentView !== 'reader') return;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (docHeight <= 0) return;
    const scrolled = (window.scrollY / docHeight) * 100;
    const bar = document.getElementById('reader-progress-bar');
    if (bar) bar.style.width = `${Math.min(100, Math.max(0, scrolled))}%`;
  }, { passive: true });
}

// ─── 9. 단축키 지원 (좌우 화살표로 회차 이동, M 목차) ──────────────
function setupKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    // 인풋창에 포커스가 있을 때는 단축키 동작 안 함
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

    if (APP_STATE.currentView === 'reader') {
      if (e.key === 'ArrowLeft') {
        goToPrevEpisode();
      } else if (e.key === 'ArrowRight') {
        goToNextEpisode();
      } else if (e.key.toLowerCase() === 'm') {
        openTocModal();
      }
    }
  });
}

// ─── 10. 목차 (TOC) 모달 ─────────────────────────────────────────
function openTocModal() {
  document.getElementById('modal-toc').classList.remove('hidden');
}

function closeTocModal() {
  document.getElementById('modal-toc').classList.add('hidden');
}

function renderTocModal(allEpisodes) {
  const container = document.getElementById('toc-list-container');
  if (!allEpisodes || allEpisodes.length === 0) {
    container.innerHTML = `<div style="padding: 16px; text-align: center; color: #94a3b8;">목차가 없습니다.</div>`;
    return;
  }

  container.innerHTML = allEpisodes.map(ep => {
    const isCurrent = ep.id === APP_STATE.currentEpisodeId;
    return `
      <div class="episode-item ${isCurrent ? 'active' : ''}" style="${isCurrent ? 'background: #eef2ff; border-color: #6366f1; font-weight: 700;' : ''}" onclick="closeTocModal(); openReader('${APP_STATE.currentNovelId}', '${ep.id}')">
        <span>${escapeHtml(ep.title)}</span>
        ${isCurrent ? '<span style="color: #6366f1; font-size: 0.8rem;">현재 읽는 중</span>' : ''}
      </div>
    `;
  }).join('');
}

// ─── 11. TTS 음성 읽기 (Web Speech API) ──────────────────────────
function toggleTTS() {
  if (!('speechSynthesis' in window)) {
    showToast('현재 브라우저가 음성 합성(TTS)을 지원하지 않습니다.');
    return;
  }

  const btn = document.getElementById('btn-tts-toggle');
  if (APP_STATE.tts.isPlaying) {
    stopTTS();
    showToast('TTS 음성 읽기를 정지했습니다.');
  } else {
    startTTS();
  }
}

function startTTS() {
  const article = document.getElementById('reader-article');
  if (!article) return;
  const text = article.innerText;
  if (!text.trim()) return;

  window.speechSynthesis.cancel(); // 기존 재생 정지
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ko-KR';
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  utterance.onend = () => {
    APP_STATE.tts.isPlaying = false;
    updateTTSButton(false);
  };
  utterance.onerror = () => {
    APP_STATE.tts.isPlaying = false;
    updateTTSButton(false);
  };

  window.speechSynthesis.speak(utterance);
  APP_STATE.tts.isPlaying = true;
  APP_STATE.tts.utterance = utterance;
  updateTTSButton(true);
  showToast('🔊 소설 음성 읽기(TTS)를 시작합니다.');
}

function stopTTS() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  APP_STATE.tts.isPlaying = false;
  updateTTSButton(false);
}

function updateTTSButton(isPlaying) {
  const btn = document.getElementById('btn-tts-toggle');
  if (btn) {
    btn.innerHTML = isPlaying ? `<i class="fa-solid fa-volume-high" style="color: #6366f1;"></i>` : `<i class="fa-solid fa-headphones"></i>`;
  }
}

// ─── 12. 앰비언스 BGM 신디사이저 (Web Audio API) ─────────────────
function openBgmModal() {
  document.getElementById('modal-bgm').classList.remove('hidden');
}

function closeBgmModal() {
  document.getElementById('modal-bgm').classList.add('hidden');
}

function initAudioContext() {
  if (!APP_STATE.bgm.audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    APP_STATE.bgm.audioCtx = new AudioCtx();
    APP_STATE.bgm.gainNode = APP_STATE.bgm.audioCtx.createGain();
    APP_STATE.bgm.gainNode.gain.value = APP_STATE.bgm.volume;
    APP_STATE.bgm.gainNode.connect(APP_STATE.bgm.audioCtx.destination);
  }
  if (APP_STATE.bgm.audioCtx.state === 'suspended') {
    APP_STATE.bgm.audioCtx.resume();
  }
}

function setBgmVolume(val) {
  APP_STATE.bgm.volume = parseFloat(val);
  if (APP_STATE.bgm.gainNode) {
    APP_STATE.bgm.gainNode.gain.value = APP_STATE.bgm.volume;
  }
}

function selectBgm(soundType) {
  initAudioContext();
  stopAllBgm();

  if (soundType === 'rain') {
    playRainSound();
  } else if (soundType === 'fire') {
    playFireSound();
  } else if (soundType === 'harp') {
    playHarpMelody();
  }

  APP_STATE.bgm.activeSound = soundType;
  updateBgmUI();
  showToast(`🎶 앰비언스 사운드가 시작되었습니다.`);
}

function stopAllBgm() {
  APP_STATE.bgm.sourceNodes.forEach(node => {
    try { node.stop(); node.disconnect(); } catch (e) {}
  });
  APP_STATE.bgm.sourceNodes = [];
  APP_STATE.bgm.activeSound = null;
  updateBgmUI();
}

function updateBgmUI() {
  ['rain', 'fire', 'harp'].forEach(type => {
    const card = document.querySelector(`.bgm-card[data-sound="${type}"]`);
    const status = document.getElementById(`bgm-status-${type}`);
    const isActive = APP_STATE.bgm.activeSound === type;
    if (card) card.classList.toggle('active', isActive);
    if (status) status.textContent = isActive ? '재생 중' : '정지됨';
  });
}

// 빗소리 합성 (노이즈 + 로우패스 필터)
function playRainSound() {
  const ctx = APP_STATE.bgm.audioCtx;
  const bufferSize = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1000;

  noise.connect(filter);
  filter.connect(APP_STATE.bgm.gainNode);
  noise.start();
  APP_STATE.bgm.sourceNodes.push(noise);
}

// 모닥불 소리 합성
function playFireSound() {
  const ctx = APP_STATE.bgm.audioCtx;
  const bufferSize = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() > 0.995) ? (Math.random() * 2 - 1) * 3 : (Math.random() * 0.05);
  }

  const fireSource = ctx.createBufferSource();
  fireSource.buffer = buffer;
  fireSource.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 600;

  fireSource.connect(filter);
  filter.connect(APP_STATE.bgm.gainNode);
  fireSource.start();
  APP_STATE.bgm.sourceNodes.push(fireSource);
}

// 판타지 하프 아르페지오 멜로디
function playHarpMelody() {
  const ctx = APP_STATE.bgm.audioCtx;
  const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99]; // C E G C E G
  let step = 0;

  const intervalId = setInterval(() => {
    if (APP_STATE.bgm.activeSound !== 'harp') {
      clearInterval(intervalId);
      return;
    }
    const osc = ctx.createOscillator();
    const noteGain = ctx.createGain();
    const freq = notes[step % notes.length];
    step++;

    osc.type = 'sine';
    osc.frequency.value = freq;

    noteGain.gain.setValueAtTime(0.15, ctx.currentTime);
    noteGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.8);

    osc.connect(noteGain);
    noteGain.connect(APP_STATE.bgm.gainNode);
    osc.start();
    osc.stop(ctx.currentTime + 1.8);
  }, 700);
}

// ─── 13. 회차별 독자 댓글 시스템 ──────────────────────────────────
async function fetchComments(novelId, episodeId) {
  try {
    const res = await fetch(`/api/comments?novelId=${novelId}&episodeId=${episodeId}`);
    const data = await res.json();
    if (data.success) {
      renderComments(data.comments);
    }
  } catch (e) {
    console.warn('댓글 로드 실패:', e);
  }
}

function renderComments(comments) {
  const container = document.getElementById('comments-list');
  const countSpan = document.getElementById('rc-count');
  countSpan.textContent = comments.length;

  if (comments.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: #94a3b8; padding: 20px;">아직 작성된 댓글이 없습니다. 첫 댓글을 남겨보세요!</div>`;
    return;
  }

  container.innerHTML = comments.map(c => {
    const date = (c.createdAt || '').slice(0, 16).replace('T', ' ');
    return `
      <div class="comment-card">
        <div class="cc-header">
          <span class="cc-author"><i class="fa-regular fa-user"></i> ${escapeHtml(c.author)}</span>
          <span class="cc-date">${date}</span>
        </div>
        <div class="cc-content">${escapeHtml(c.content)}</div>
      </div>
    `;
  }).join('');
}

async function submitComment() {
  const authorInput = document.getElementById('comment-author-input');
  const contentInput = document.getElementById('comment-content-input');
  const author = authorInput.value.trim() || (APP_STATE.member ? APP_STATE.member.nickname : '독자');
  const content = contentInput.value.trim();

  if (!content) {
    showToast('댓글 내용을 입력해 주세요.');
    return;
  }

  try {
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: APP_STATE.currentNovelId,
        episodeId: APP_STATE.currentEpisodeId,
        author,
        content
      })
    });
    const data = await res.json();
    if (data.success) {
      contentInput.value = '';
      fetchComments(APP_STATE.currentNovelId, APP_STATE.currentEpisodeId);
      showToast('댓글이 성공적으로 등록되었습니다!');
    }
  } catch (e) {
    showToast('댓글 등록 실패');
  }
}

// ─── 14. 소설 텍스트(.txt) 소장 다운로드 ─────────────────────────
function downloadCurrentEpisodeTxt() {
  if (!APP_STATE.currentNovelId || !APP_STATE.currentEpisodeId) return;
  window.location.href = `/api/novels/${APP_STATE.currentNovelId}/export?episodeId=${APP_STATE.currentEpisodeId}`;
}

function downloadNovelTxt(novelId) {
  window.location.href = `/api/novels/${novelId}/export`;
}

// ─── 15. 작가 집필 스튜디오 (STUDIO) ──────────────────────────────
function switchStudioTab(tabId) {
  document.querySelectorAll('.studio-tab-pane').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.s-tab-btn').forEach(b => b.classList.remove('active'));

  const targetPane = document.getElementById(tabId);
  if (targetPane) targetPane.classList.remove('hidden');

  const targetBtn = document.querySelector(`.s-tab-btn[data-tab="${tabId}"]`);
  if (targetBtn) targetBtn.classList.add('active');
}

function selectCoverPreset(presetName) {
  APP_STATE.selectedCoverPreset = presetName;
  document.querySelectorAll('.cover-preset-item').forEach(item => {
    item.classList.toggle('active', item.dataset.cover === presetName);
  });
}

function populateStudioNovels() {
  const select = document.getElementById('editor-novel-select');
  if (!select) return;
  select.innerHTML = '<option value="">작품을 선택해 주세요</option>' + APP_STATE.novels.map(n => {
    return `<option value="${n.id}" ${APP_STATE.selectedNovel && APP_STATE.selectedNovel.id === n.id ? 'selected' : ''}>${escapeHtml(n.title)} (${n.episodeCount}화 연재중)</option>`;
  }).join('');
  onEditorNovelChange();
}

function writeNextEpisodeForNovel(novelId) {
  navigate('studio');
  switchStudioTab('tab-write-episode');
  const select = document.getElementById('editor-novel-select');
  if (select) {
    select.value = novelId;
    onEditorNovelChange();
  }
}

function onEditorNovelChange() {
  const select = document.getElementById('editor-novel-select');
  const display = document.getElementById('editor-ep-num-display');
  const novelId = select.value;
  const novel = APP_STATE.novels.find(n => n.id === novelId);
  if (novel) {
    const nextNum = (novel.episodeCount || 0) + 1;
    display.value = `제 ${nextNum} 화`;
    document.getElementById('editor-ep-title').placeholder = `예: 제${nextNum}화: 제목 입력`;
  } else {
    display.value = '자동 계산';
  }
}

function onEditorContentInput() {
  const textarea = document.getElementById('editor-ep-content');
  const content = textarea.value;
  const withSpace = content.length;
  const noSpace = content.replace(/\s/g, '').length;
  const readMins = Math.max(1, Math.round(withSpace / 600));

  document.getElementById('editor-chars-with-space').textContent = `${withSpace.toLocaleString()}자 (공백포함)`;
  document.getElementById('editor-chars-no-space').textContent = `${noSpace.toLocaleString()}자 (공백제외)`;
  document.getElementById('editor-read-time').textContent = `예상 약 ${readMins}분`;
}

// 자동 임시저장 (Auto-save)
function setupAutoSave() {
  setInterval(() => {
    if (APP_STATE.currentView === 'studio') {
      const content = document.getElementById('editor-ep-content')?.value;
      const title = document.getElementById('editor-ep-title')?.value;
      const novelId = document.getElementById('editor-novel-select')?.value;
      if (content && content.trim().length > 10) {
        localStorage.setItem('novel_draft', JSON.stringify({
          novelId,
          title,
          content,
          time: new Date().toLocaleTimeString('ko-KR')
        }));
        const indicator = document.getElementById('autosave-indicator');
        if (indicator) {
          indicator.innerHTML = `<i class="fa-solid fa-check"></i> 방금 임시저장됨`;
          setTimeout(() => {
            indicator.innerHTML = `<i class="fa-regular fa-clock"></i> 자동저장 대기`;
          }, 3000);
        }
      }
    }
  }, 15000); // 15초마다
}

function loadDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem('novel_draft') || '{}');
    if (draft.content) {
      if (draft.novelId) document.getElementById('editor-novel-select').value = draft.novelId;
      if (draft.title) document.getElementById('editor-ep-title').value = draft.title;
      document.getElementById('editor-ep-content').value = draft.content;
      onEditorContentInput();
      showToast(`💾 ${draft.time}에 저장된 임시 집필 내용을 불러왔습니다.`);
    } else {
      showToast('저장된 임시 집필 내용이 없습니다.');
    }
  } catch (e) {
    showToast('임시저장 불러오기 실패');
  }
}

function clearDraft() {
  if (confirm('작성 중인 내용을 모두 지우시겠습니까?')) {
    document.getElementById('editor-ep-title').value = '';
    document.getElementById('editor-ep-content').value = '';
    document.getElementById('editor-author-note').value = '';
    onEditorContentInput();
    localStorage.removeItem('novel_draft');
    showToast('작성창을 비웠습니다.');
  }
}

// 회차 발행 핸들러
async function handleEpisodeSubmit(e) {
  e.preventDefault();
  const novelId = document.getElementById('editor-novel-select').value;
  const title = document.getElementById('editor-ep-title').value;
  const content = document.getElementById('editor-ep-content').value;
  const authorNote = document.getElementById('editor-author-note').value;
  const password = document.getElementById('editor-password').value;

  if (!novelId) {
    showToast('집필할 작품을 선택해 주세요.');
    return;
  }

  const btn = document.getElementById('btn-publish-ep');
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 발행 중...`;

  try {
    const res = await fetch(`/api/novels/${novelId}/episodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, authorNote, password })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`🎉 제${data.episodeNumber}화가 성공적으로 발행되었습니다!`);
      localStorage.removeItem('novel_draft');
      clearDraft();
      await fetchNovels();
      openReader(novelId, data.episodeId);
    } else {
      showToast(data.message || '회차 발행에 실패했습니다.');
    }
  } catch (err) {
    showToast('네트워크 오류가 발생했습니다.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-upload"></i> 회차 즉시 발행하기`;
  }
}

// 새 작품 등록 핸들러
async function handleNewNovelSubmit(e) {
  e.preventDefault();
  const title = document.getElementById('nn-title').value;
  const author = document.getElementById('nn-author').value;
  const genre = document.getElementById('nn-genre').value;
  const status = document.getElementById('nn-status').value;
  const password = document.getElementById('nn-password').value;
  const synopsis = document.getElementById('nn-synopsis').value;
  const cover = APP_STATE.selectedCoverPreset;

  try {
    const res = await fetch('/api/novels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, author, genre, status, password, synopsis, cover })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`📚 『${title}』 작품이 성공적으로 등록되었습니다!`);
      await fetchNovels();
      openNovelDetail(data.novelId);
    } else {
      showToast(data.message || '작품 등록 실패');
    }
  } catch (err) {
    showToast('오류가 발생했습니다.');
  }
}

// 집필 통계 인포그래픽
function updateStudioStats() {
  const card = document.getElementById('studio-stats-card');
  if (!card) return;

  const totalNovels = APP_STATE.novels.length;
  const totalEps = APP_STATE.novels.reduce((acc, n) => acc + (n.episodeCount || 0), 0);
  const totalWords = APP_STATE.novels.reduce((acc, n) => acc + (n.totalWords || 0), 0);
  const totalViews = APP_STATE.novels.reduce((acc, n) => acc + (n.views || 0), 0);

  card.innerHTML = `
    <h3 style="margin-bottom: 8px;"><i class="fa-solid fa-feather-pointed"></i> 나의 연재 스튜디오 실시간 누적 기록</h3>
    <p style="color: #64748b; font-size: 0.9rem;">독자들과 나눈 소중한 이야기들의 총합입니다.</p>
    <div class="stats-grid-4">
      <div class="stat-box">
        <div class="sb-val">${totalNovels}</div>
        <div class="sb-label">보관 작품수</div>
      </div>
      <div class="stat-box">
        <div class="sb-val">${totalEps}</div>
        <div class="sb-label">총 연재 회차수</div>
      </div>
      <div class="stat-box">
        <div class="sb-val">${(totalWords / 1000).toFixed(1)}k</div>
        <div class="sb-label">총 집필 글자수 (${totalWords.toLocaleString()}자)</div>
      </div>
      <div class="stat-box">
        <div class="sb-val">${totalViews.toLocaleString()}</div>
        <div class="sb-label">누적 열람 독자수</div>
      </div>
    </div>
  `;
}

// ─── 16. 내 서재 & 이어보기 (LIBRARY) ────────────────────────────
function saveReadingHistory(novelId, novelTitle, episodeId, episodeTitle, epNumber) {
  try {
    let history = JSON.parse(localStorage.getItem('novel_history') || '[]');
    history = history.filter(h => h.novelId !== novelId);
    history.unshift({
      novelId,
      novelTitle,
      episodeId,
      episodeTitle,
      epNumber,
      readAt: new Date().toISOString()
    });
    if (history.length > 20) history.length = 20;
    localStorage.setItem('novel_history', JSON.stringify(history));
  } catch (e) {}
}

function renderLibraryView() {
  const container = document.getElementById('recent-reads-grid');
  if (!container) return;

  const history = JSON.parse(localStorage.getItem('novel_history') || '[]');
  if (history.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; background: #fff; border-radius: 12px; border: 1px dashed #cbd5e1;">
        <i class="fa-solid fa-book-bookmark" style="font-size: 2.5rem; color: #94a3b8; margin-bottom: 12px;"></i>
        <h4 style="color: #475569; margin-bottom: 6px;">아직 읽은 소설이 없습니다.</h4>
        <p style="color: #94a3b8; margin-bottom: 16px;">탐색 탭에서 흥미진진한 작품을 시작해 보세요!</p>
        <button class="btn-primary" onclick="navigate('home')">소설 탐색하러 가기</button>
      </div>
    `;
    return;
  }

  container.innerHTML = history.map(h => {
    return `
      <div class="read-history-card">
        <div class="rhc-title">${escapeHtml(h.novelTitle)}</div>
        <div class="rhc-ep"><i class="fa-solid fa-bookmark"></i> 최근 읽은 회차: ${escapeHtml(h.episodeTitle)}</div>
        <button class="btn-card-binge mt-2" onclick="openReader('${h.novelId}', '${h.episodeId}')">
          <i class="fa-solid fa-play"></i> 이어서 읽기
        </button>
      </div>
    `;
  }).join('');
}

function toggleBookmark(novelId) {
  showToast('🔖 내 서재 보관함에 담겼습니다!');
}

// ─── 17. 간편 회원가입 / 1초 인증 모달 ────────────────────────────
function openAuthModal() {
  document.getElementById('modal-auth').classList.remove('hidden');
}

function closeAuthModal() {
  document.getElementById('modal-auth').classList.add('hidden');
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const phone = document.getElementById('auth-phone').value;
  const nickname = document.getElementById('auth-nickname').value;
  const carrier = document.getElementById('auth-carrier').value;
  const ageGroup = document.getElementById('auth-age').value;
  const gender = document.getElementById('auth-gender').value;
  const email = document.getElementById('auth-email').value;
  const interests = document.getElementById('auth-interests').value;
  const marketingConsent = document.getElementById('agree-marketing').checked;

  try {
    const res = await fetch('/api/members/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone, nickname, carrier, ageGroup, gender, email, interests, marketingConsent
      })
    });
    const data = await res.json();
    if (data.success) {
      APP_STATE.member = data.member;
      localStorage.setItem('novel_member', JSON.stringify(data.member));
      updateMemberUI();
      closeAuthModal();
      showToast(`🎉 ${data.member.nickname}님, 환영합니다!`);
    } else {
      showToast(data.message || '가입 처리 실패');
    }
  } catch (err) {
    showToast('오류가 발생했습니다.');
  }
}

function updateMemberUI() {
  const btn = document.getElementById('header-user-btn');
  const mBtn = document.getElementById('m-user-text');
  if (APP_STATE.member) {
    if (btn) btn.innerHTML = `<i class="fa-solid fa-user-check"></i> <span>${escapeHtml(APP_STATE.member.nickname)}</span>`;
    if (mBtn) mBtn.textContent = `${APP_STATE.member.nickname} 독자님`;
  }
}

// ─── 18. 공유하기 모달 ───────────────────────────────────────────
function openShareModal() {
  const input = document.getElementById('share-link-input');
  if (input) input.value = window.location.href;
  document.getElementById('modal-share').classList.remove('hidden');
}

function closeShareModal() {
  document.getElementById('modal-share').classList.add('hidden');
}

function copyShareLink() {
  const input = document.getElementById('share-link-input');
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    showToast('🔗 소설 링크가 클립보드에 복사되었습니다!');
  }).catch(() => {
    showToast('링크 복사 완료');
  });
}

function shareTwitter() {
  const text = encodeURIComponent(`소설 아카이브 스튜디오에서 흥미진진한 웹소설을 감상해 보세요!`);
  const url = encodeURIComponent(window.location.href);
  window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank');
}

function shareKakao() {
  showToast('카카오톡 공유 링크를 복사했습니다.');
  copyShareLink();
}

// ─── 19. 최고 관리자 대시보드 ────────────────────────────────────
function openAdminModal() {
  if (APP_STATE.adminToken) {
    navigate('admin');
  } else {
    document.getElementById('modal-admin-login').classList.remove('hidden');
  }
}

function closeAdminModal() {
  document.getElementById('modal-admin-login').classList.add('hidden');
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const id = document.getElementById('admin-id-input').value;
  const password = document.getElementById('admin-pw-input').value;

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, password })
    });
    const data = await res.json();
    if (data.success) {
      APP_STATE.adminToken = data.token;
      sessionStorage.setItem('novel_admin_token', data.token);
      closeAdminModal();
      navigate('admin');
      showToast('🛡️ 최고 관리자 인증 성공!');
    } else {
      showToast(data.message || '인증 실패');
    }
  } catch (err) {
    showToast('로그인 처리 중 오류');
  }
}

function adminLogout() {
  APP_STATE.adminToken = null;
  sessionStorage.removeItem('novel_admin_token');
  navigate('home');
  showToast('관리자 모드에서 로그아웃되었습니다.');
}

async function loadAdminDashboard() {
  try {
    const res = await fetch('/api/admin/stats');
    const data = await res.json();
    if (!data.success) return;

    // KPI
    document.getElementById('kpi-members').textContent = data.stats.totalMembers;
    document.getElementById('kpi-novels').textContent = data.stats.totalNovels;
    document.getElementById('kpi-episodes').textContent = data.stats.totalEpisodes;
    document.getElementById('kpi-views').textContent = data.stats.totalViews.toLocaleString();
    document.getElementById('kpi-visitors').textContent = data.stats.totalVisitors;

    // 회원 테이블
    const membersTbody = document.getElementById('admin-members-tbody');
    membersTbody.innerHTML = (data.members || []).map(m => `
      <tr>
        <td>${m.id}</td>
        <td><strong>${m.phone}</strong></td>
        <td>${escapeHtml(m.nickname)}</td>
        <td>${m.carrier}</td>
        <td>${escapeHtml(m.email || '-')}</td>
        <td>${m.ageGroup}</td>
        <td>${m.gender}</td>
        <td>${escapeHtml(m.interests)}</td>
        <td>${m.marketingConsent ? '<span style="color: #10b981; font-weight:700;">동의</span>' : '미동의'}</td>
        <td><code>${m.ip}</code></td>
        <td>${(m.createdAt || '').slice(0, 16).replace('T', ' ')}</td>
      </tr>
    `).join('');

    // 소설 테이블
    const novelsTbody = document.getElementById('admin-novels-tbody');
    novelsTbody.innerHTML = (data.novels || []).map(n => `
      <tr>
        <td>${n.id}</td>
        <td><strong>${escapeHtml(n.title)}</strong></td>
        <td>${escapeHtml(n.author)}</td>
        <td>${n.genre}</td>
        <td>${n.status}</td>
        <td>${n.episodesCount}화</td>
        <td>${(n.views || 0).toLocaleString()}</td>
        <td>${(n.likes || 0).toLocaleString()}</td>
        <td>${(n.createdAt || '').slice(0, 10)}</td>
      </tr>
    `).join('');

    // 텔레메트리 테이블
    const telemetryTbody = document.getElementById('admin-telemetry-tbody');
    telemetryTbody.innerHTML = (data.recentVisitors || []).map(v => `
      <tr>
        <td>${(v.timestamp || '').slice(0, 19).replace('T', ' ')}</td>
        <td><code>${v.ip}</code></td>
        <td>${v.visitCount}회차</td>
        <td><span style="background: #eef2ff; color:#4f46e5; padding: 2px 6px; border-radius: 4px; font-weight: 600;">${escapeHtml(v.channel)}</span></td>
        <td>${escapeHtml(v.connection)}</td>
        <td><small>${escapeHtml(v.gpu.slice(0, 30))}</small></td>
        <td>Cores ${v.cores} / RAM ${v.memory}GB</td>
        <td>${v.screen} (DPR ${v.dpr})</td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('관리자 대시보드 로드 에러:', e);
  }
}

function switchAdminTab(tabId) {
  document.querySelectorAll('.admin-tab-pane').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.a-tab-btn').forEach(b => b.classList.remove('active'));

  const targetPane = document.getElementById(tabId);
  if (targetPane) targetPane.classList.remove('hidden');

  event.currentTarget.classList.add('active');
}

function downloadMembersExcel() {
  window.location.href = '/api/admin/export-members';
}

function downloadNovelsExcel() {
  window.location.href = '/api/admin/export-novels';
}

// ─── 유틸리티 ───────────────────────────────────────────────────
function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 2800);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
