const state = {
  messages: [],
  results: [],
  tasks: JSON.parse(localStorage.getItem('taskmate_tasks') || '[]')
};

const taskWords = ['완료', '제출', '정리', '조사', '자료', '공유', '수정', '확인', '피드백', '회의', '발표', 'ppt', 'PPT', '보고서', '코드', '마감', '기한', '올림', '작성', '분석', '설계', '업로드'];
const scheduleWords = ['마감', '제출', '회의', '발표', '기한', '까지', '모임', '만나', '검토', '완성'];
const attachmentWords = ['사진', '동영상', '파일', '첨부', '보이스톡', '카카오톡 프로필', '지도', '연락처'];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function saveTasks() {
  localStorage.setItem('taskmate_tasks', JSON.stringify(state.tasks));
}

function to24Hour(period, hour) {
  let h = Number(hour);
  if (period === '오후' && h !== 12) h += 12;
  if (period === '오전' && h === 12) h = 0;
  return h;
}

function parseKakaoText(text) {
  const lines = text.replace(/\r/g, "").split("\n");

  const messages = [];
  let currentDate = null;
  let last = null;

  // 1) 날짜 줄 (2026년 3월 9일 월요일)
  const dateLine = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/;

  // 2) 괄호형
  // [이름] [오전 8:31] 내용
  const bracketLine =
    /^\[(.+?)\]\s*\[(오전|오후)\s*(\d{1,2}):(\d{2})\]\s*(.*)$/;

  // 3) 콤마형 (카카오 export)
  // 2026. 3. 9. 오후 8:31, 이름 : 내용
  const commaLine =
    /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2}),\s*([^:]+?)\s*:\s*(.*)$/;

  const to24 = (period, hour) => {
    let h = Number(hour);
    if (period === "오후" && h !== 12) h += 12;
    if (period === "오전" && h === 12) h = 0;
    return h;
  };

  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // 1) 날짜 처리
    const d = line.match(dateLine);
    if (d) {
      currentDate = `${d[1]}-${String(d[2]).padStart(2, "0")}-${String(d[3]).padStart(2, "0")}`;
      last = null;
      continue;
    }

    // 2) 콤마형 메시지
    const c = line.match(commaLine);
    if (c) {
      const hour = to24(c[4], c[5]);

      last = {
        name: c[7].trim(),
        text: c[8].trim(),
        date: `${c[1]}-${String(c[2]).padStart(2, "0")}-${String(c[3]).padStart(2, "0")}`,
        time: `${String(hour).padStart(2, "0")}:${c[6]}`
      };

      messages.push(last);
      continue;
    }

    // 3) 괄호형 메시지
    const b = line.match(bracketLine);
    if (b && currentDate) {
      const hour = to24(b[2], b[3]);

      last = {
        name: b[1].trim(),
        text: b[5].trim(),
        date: currentDate,
        time: `${String(hour).padStart(2, "0")}:${b[4]}`
      };

      messages.push(last);
      continue;
    }

    // 4) fallback: 줄바꿈 메시지 합치기 (핵심 안정성)
    if (
      last &&
      !line.includes("님이 들어왔습니다") &&
      !line.includes("님이 나갔습니다") &&
      !line.includes("초대했습니다")
    ) {
      last.text += "\n" + line;
    }
  }

  // 5) 최종 필터링 (깨진 데이터 제거)
  return messages.filter(
    (m) =>
      m &&
      m.name &&
      m.text &&
      m.name.length > 0 &&
      m.text.length > 0 &&
      !m.name.includes("저장한 날짜")
  );
}

function countContains(text, words) {
  return words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
}

function analyze(messages) {
  const byMember = new Map();
  for (const msg of messages) {
    if (!byMember.has(msg.name)) {
      byMember.set(msg.name, {
        name: msg.name,
        messages: 0,
        chars: 0,
        attachments: 0,
        links: 0,
        taskHits: 0,
        questions: 0,
        longMessages: 0,
        activeDates: new Set(),
        rawScore: 0,
        contribution: 0
      });
    }
    const row = byMember.get(msg.name);
    const text = msg.text;
    row.messages += 1;
    row.chars += text.replace(/\s/g, '').length;
    row.attachments += countContains(text, attachmentWords);
    row.links += (text.match(/https?:\/\/|www\./gi) || []).length;
    row.taskHits += countContains(text, taskWords);
    row.questions += (text.match(/[?？]/g) || []).length + (/(어떻게|언제|누가|할까|맞아|가능|왜)/.test(text) ? 1 : 0);
    row.longMessages += text.length >= 60 ? 1 : 0;
    if (msg.date) row.activeDates.add(msg.date);
  }

  const rows = [...byMember.values()].map(row => ({...row, activeDays: row.activeDates.size}));
  const max = (key) => Math.max(1, ...rows.map(r => r[key]));
  const maxActivity = {
    messages: max('messages'),
    chars: max('chars'),
    taskHits: max('taskHits'),
    resource: Math.max(1, ...rows.map(r => r.attachments + r.links)),
    activeDays: max('activeDays'),
    longMessages: max('longMessages')
  };

  rows.forEach(row => {
    const resource = row.attachments + row.links;
    row.rawScore =
      0.30 * (row.messages / maxActivity.messages) +
      0.25 * (row.chars / maxActivity.chars) +
      0.18 * (row.taskHits / maxActivity.taskHits) +
      0.12 * (resource / maxActivity.resource) +
      0.10 * (row.activeDays / maxActivity.activeDays) +
      0.05 * (row.longMessages / maxActivity.longMessages);
  });

  const totalRaw = rows.reduce((sum, row) => sum + row.rawScore, 0) || 1;
  rows.forEach(row => {
    row.contribution = Math.round((row.rawScore / totalRaw) * 1000) / 10;
  });

  return rows.sort((a, b) => b.contribution - a.contribution);
}

function findScheduleCandidates(messages) {
  const regexDate = /(\d{1,2}[\/월.]\s*\d{1,2}일?|\d{1,2}일|내일|모레|이번\s*(주|주말)|다음\s*(주|주말)|월요일|화요일|수요일|목요일|금요일|토요일|일요일)/;
  return messages
    .filter(m => scheduleWords.some(w => m.text.includes(w)) || regexDate.test(m.text))
    .slice(-20)
    .reverse();
}

function renderStats() {
  const messages = state.messages;
  const results = state.results;
  const members = results.length;
  const totalChars = messages.reduce((sum, m) => sum + m.text.length, 0);
  const dateSet = new Set(messages.map(m => m.date).filter(Boolean));
  const top = results[0];

  $('#emptyState').classList.add('hidden');
  $('#statsGrid').classList.remove('hidden');
  $('#chartWrap').classList.remove('hidden');
  $('#tableWrap').classList.remove('hidden');

  $('#statsGrid').innerHTML = `
    <div class="statCard"><span>분석 메시지</span><strong>${messages.length.toLocaleString()}</strong></div>
    <div class="statCard"><span>참여 멤버</span><strong>${members}</strong></div>
    <div class="statCard"><span>총 글자 수</span><strong>${totalChars.toLocaleString()}</strong></div>
    <div class="statCard"><span>활동일</span><strong>${dateSet.size}</strong></div>
  `;

  $('#messageCount').textContent = `${messages.length.toLocaleString()} messages`;
  $('#topScore').textContent = top ? `${top.contribution}%` : '-';
  $('#topMember').textContent = top ? `${top.name}님이 가장 높음` : '파일을 불러오면 표시됩니다';

  $('#barChart').innerHTML = results.map(row => `
    <div class="barRow">
      <div class="barLabel" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</div>
      <div class="barOuter"><div class="barInner" style="width:${Math.min(100, row.contribution)}%"></div></div>
      <div class="barValue">${row.contribution}%</div>
    </div>
  `).join('');

  $('#resultBody').innerHTML = results.map(row => `
    <tr>
      <td>${escapeHtml(row.name)}</td>
      <td><strong>${row.contribution}%</strong></td>
      <td>${row.messages.toLocaleString()}</td>
      <td>${row.chars.toLocaleString()}</td>
      <td>${(row.attachments + row.links).toLocaleString()}</td>
      <td>${row.taskHits.toLocaleString()}</td>
      <td>${row.activeDays.toLocaleString()}</td>
      <td>${row.questions.toLocaleString()}</td>
    </tr>
  `).join('');

  renderInsights();
  renderCandidates();
}

function renderInsights() {
  if (!state.results.length) return;
  const top = state.results[0];
  const low = state.results[state.results.length - 1];
  const total = state.messages.length;
  const topMsgShare = Math.round((top.messages / total) * 1000) / 10;
  const gap = Math.round((top.contribution - low.contribution) * 10) / 10;

  $('#insightBox').innerHTML = `
    <p><b>${escapeHtml(top.name)}</b>님의 참고 기여도가 <b>${top.contribution}%</b>로 가장 높습니다. 전체 메시지 중 약 <b>${topMsgShare}%</b>를 차지했고, 과제 관련 키워드는 <b>${top.taskHits}회</b> 감지되었습니다.</p>
    <p>최고/최저 기여도 차이는 <b>${gap}%p</b>입니다. 단, 발표력·리더십·오프라인 회의 참여처럼 대화량으로 잡히지 않는 부분은 별도 평가가 필요합니다.</p>
  `;
}

function renderCandidates() {
  const candidates = findScheduleCandidates(state.messages);
  if (!candidates.length) {
    $('#candidateBox').textContent = '일정 후보가 발견되지 않았습니다. “마감”, “제출”, “회의”, “발표”, “까지” 같은 단어가 있는 메시지가 있으면 여기에 표시됩니다.';
    return;
  }
  $('#candidateBox').innerHTML = candidates.slice(0, 8).map(m => `
    <div class="candidateItem">
      <small>${escapeHtml(m.date || '')} ${escapeHtml(m.time || '')} · ${escapeHtml(m.name)}</small>
      <div>${escapeHtml(m.text).slice(0, 170)}${m.text.length > 170 ? '...' : ''}</div>
    </div>
  `).join('');
}

function renderTasks() {
  const list = $('#taskList');
  const tasks = [...state.tasks].sort((a, b) => new Date(a.due) - new Date(b.due));

  if (!tasks.length) {
    list.innerHTML = '<div class="emptyState"><strong>등록된 일정이 없습니다.</strong><p>마감일, 담당자, 진행 상태를 추가하면 D-DAY가 자동 계산됩니다.</p></div>';
    $('#nearestDday').textContent = '-';
    $('#nearestTask').textContent = '일정을 추가하세요';
    return;
  }

  const activeTasks = tasks.filter(t => t.status !== 'done');
  const nearest = activeTasks[0] || tasks[0];
  $('#nearestDday').textContent = formatDday(nearest.due);
  $('#nearestTask').textContent = nearest.title;

  list.innerHTML = tasks.map(task => `
    <div class="taskItem">
      <div class="dday">${formatDday(task.due)}</div>
      <div>
        <strong>${escapeHtml(task.title)}</strong>
        <div class="taskMeta">담당: ${escapeHtml(task.owner || '미정')} · 마감: ${task.due}</div>
      </div>
      <span class="badge ${task.status}">${statusText(task.status)}</span>
      <button class="deleteBtn" data-id="${task.id}">삭제</button>
    </div>
  `).join('');

  $$('.deleteBtn').forEach(btn => btn.addEventListener('click', () => {
    state.tasks = state.tasks.filter(t => String(t.id) !== btn.dataset.id);
    saveTasks();
    renderTasks();
  }));
}

function formatDday(dateString) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateString + 'T00:00:00');
  const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'D-DAY';
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

function statusText(status) {
  return { todo: '예정', doing: '진행중', done: '완료' }[status] || status;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, s => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[s]));
}

function exportCsv() {
  if (!state.results.length) return alert('먼저 카톡 TXT 파일을 분석하세요.');
  const header = ['멤버', '기여도', '메시지', '글자수', '자료링크', '과제키워드', '활동일', '질문'];
  const rows = state.results.map(r => [r.name, r.contribution, r.messages, r.chars, r.attachments + r.links, r.taskHits, r.activeDays, r.questions]);
  const csv = [header, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '과제메이트_기여도분석.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function loadDemo() {
  const demo = `
2026. 6. 1. 오후 2:12, 석훈 : 자료 조사한 거 링크 공유할게 https://example.com
2026. 6. 1. 오후 2:20, 민성 : 확인했습니다. 저는 발표 대본 정리할게요.
2026. 6. 1. 오후 2:30, 도헌 : PPT 표지는 제가 만들어보겠습니다.
2026. 6. 1. 오후 3:00, 병규 : 회의는 수요일 5시에 할까요?
2026. 6. 1. 오후 3:15, 석훈 : 좋아요. 6월 5일까지 1차 완성하면 될 듯합니다.
2026. 6. 2. 오전 10:12, 석훈 : 조사 자료 추가했고 카피킬러 확인도 해야 합니다.
2026. 6. 2. 오전 10:30, 민성 : 발표 순서 정리 완료했습니다.
2026. 6. 2. 오후 1:08, 도헌 : 사진
2026. 6. 2. 오후 1:09, 도헌 : PPT 초안 올렸습니다. 수정할 부분 말해주세요.
2026. 6. 2. 오후 8:22, 병규 : 내일 회의 전에 교수님 자료도 확인하겠습니다.
`;

  state.messages = parseKakaoText(demo);
  state.results = analyze(state.messages);
  renderStats();
}

$('#chatFile').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  const messages = parseKakaoText(text);
  if (!messages.length) {
    alert('분석할 수 있는 카카오톡 메시지를 찾지 못했습니다. TXT 내보내기 형식을 확인하세요.');
    return;
  }
  state.messages = messages;
  state.results = analyze(messages);
  renderStats();
});

$('#demoBtn').addEventListener('click', loadDemo);
$('#csvBtn').addEventListener('click', exportCsv);
$('#sampleFormatBtn').addEventListener('click', () => $('#formatDialog').showModal());
$('#closeDialog').addEventListener('click', () => $('#formatDialog').close());
$('#resetBtn').addEventListener('click', () => {
  if (!confirm('분석 결과와 일정을 모두 초기화할까요?')) return;
  state.messages = [];
  state.results = [];
  state.tasks = [];
  saveTasks();
  location.reload();
});

$('#taskForm').addEventListener('submit', (event) => {
  event.preventDefault();
  state.tasks.push({
    id: Date.now(),
    title: $('#taskTitle').value.trim(),
    owner: $('#taskOwner').value.trim(),
    due: $('#taskDue').value,
    status: $('#taskStatus').value
  });
  saveTasks();
  event.target.reset();
  renderTasks();
});

renderTasks();
