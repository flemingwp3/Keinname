(function () {
  'use strict';
  var FORM = document.body.getAttribute('data-form');
  var DADOS = window.FORMULARIOS[FORM];
  var CFG = window.CONFIG || {};
  var CHAVE_LOCAL = 'poeb_form_' + FORM;
  var MAX_SEG = 180;

  // ---------- estado ----------
  var perguntas = [];
  DADOS.secoes.forEach(function (s, i) {
    s.perguntas.forEach(function (q) { q.secao = s.titulo; q.secaoN = i + 1; perguntas.push(q); });
  });
  var telas = ['abertura'].concat(perguntas.map(function (q) { return q.id; }), ['revisao', 'feito']);

  function novoId() {
    var a = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function carregar() {
    try { var s = JSON.parse(localStorage.getItem(CHAVE_LOCAL)); if (s && s.rid) return s; } catch (e) {}
    return null;
  }
  var E = carregar() || { rid: novoId(), tela: 0, aceite: false, autoriza: '', r: {}, enviado: false, inicio: new Date().toISOString() };
  function salvar() { try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(E)); } catch (e) {} }
  function resp(id) { if (!E.r[id]) E.r[id] = {}; return E.r[id]; }

  // ---------- envio ----------
  function enviar(payload, tentativas) {
    tentativas = tentativas || 3;
    payload.chave = CFG.chave; payload.form = FORM; payload.rid = E.rid;
    var envio;
    if (window.google && google.script && google.script.run) {
      envio = new Promise(function (ok, falha) {
        google.script.run
          .withSuccessHandler(function (txt) { ok(typeof txt === 'string' ? JSON.parse(txt) : txt); })
          .withFailureHandler(falha)
          .receber(JSON.stringify(payload));
      });
    } else {
      envio = fetch(CFG.endpoint, { method: 'POST', body: JSON.stringify(payload) }).then(function (r) { return r.json(); });
    }
    return envio
      .then(function (j) { if (!j.ok) throw new Error(j.erro || 'falha'); return j; })
      .catch(function (err) {
        if (tentativas > 1) return new Promise(function (ok) { setTimeout(ok, 1500); }).then(function () { return enviar(payload, tentativas - 1); });
        throw err;
      });
  }

  // ---------- utilidades de DOM ----------
  function el(tag, attrs, filhos) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (filhos || []).forEach(function (f) { if (f) n.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
    return n;
  }
  var ICON_MIC = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>';
  var ICON_STOP = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  var ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  var main = document.getElementById('conteudo');
  var barra = document.getElementById('barra');
  var contador = document.getElementById('contador');
  var nav = document.getElementById('nav');

  // ---------- gravação ----------
  var gravacao = null; // {rec, stream, chunks, t0, timer, qid}
  function mimeSuportado() {
    if (!window.MediaRecorder) return null;
    var c = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/aac'];
    for (var i = 0; i < c.length; i++) { try { if (MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch (e) {} }
    return '';
  }
  var urlsLocais = {};
  function pararGravacaoSeAtiva() { if (gravacao && gravacao.rec.state === 'recording') gravacao.rec.stop(); }

  function gravador(q) {
    var r = resp(q.id);
    var box = el('div', { class: 'gravador' });
    var btn = el('button', { type: 'button', class: 'btn-gravar', 'aria-label': 'Gravar resposta em áudio' });
    var tempo = el('div', { class: 'tempo', text: '0:00 / 3:00' });
    var estado = el('div', { class: 'estado' });
    var player = el('audio', { controls: '' }); player.hidden = true;
    var acoes = el('div', { class: 'linha-btn' });
    box.appendChild(btn); box.appendChild(tempo); box.appendChild(estado); box.appendChild(player); box.appendChild(acoes);

    function fmt(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
    function pintar() {
      acoes.innerHTML = '';
      var gravandoAqui = gravacao && gravacao.qid === q.id && gravacao.rec.state === 'recording';
      btn.innerHTML = gravandoAqui ? ICON_STOP : ICON_MIC;
      btn.classList.toggle('gravando', !!gravandoAqui);
      btn.setAttribute('aria-label', gravandoAqui ? 'Parar gravação' : 'Gravar resposta em áudio');
      if (urlsLocais[q.id]) { player.src = urlsLocais[q.id]; player.hidden = false; } else player.hidden = true;
      estado.className = 'estado';
      if (gravandoAqui) { estado.textContent = 'Gravando… toque para parar'; return; }
      var a = r.audio || {};
      if (a.status === 'enviando') { estado.textContent = 'Enviando o áudio…'; }
      else if (a.status === 'ok') { estado.className = 'estado ok'; estado.textContent = 'Áudio salvo (' + fmt(a.dur || 0) + ')'; }
      else if (a.status === 'erro') {
        estado.className = 'estado erro'; estado.textContent = 'Não foi possível enviar o áudio.';
        if (urlsLocais[q.id + '_blob']) acoes.appendChild(el('button', { type: 'button', class: 'btn sec peq', text: 'Tentar enviar de novo', onclick: function () { subir(urlsLocais[q.id + '_blob'], a.mime, a.dur); } }));
      } else { estado.textContent = 'Toque no microfone para gravar. Até 3 minutos.'; }
      if (a.status === 'ok' || a.status === 'erro') {
        btn.setAttribute('aria-label', 'Gravar de novo (substitui o áudio anterior)');
        estado.textContent += ' Toque no microfone para regravar.';
      }
    }

    function subir(blob, mime, dur) {
      r.audio = { status: 'enviando', mime: mime, dur: dur }; salvar(); pintar(); atualizarNav();
      var fr = new FileReader();
      fr.onload = function () {
        var b64 = String(fr.result).split(',')[1];
        enviar({ acao: 'audio', qid: q.id, mime: mime, dados: b64 })
          .then(function (j) { r.audio = { status: 'ok', url: j.url, mime: mime, dur: dur }; delete urlsLocais[q.id + '_blob']; })
          .catch(function () { r.audio = { status: 'erro', mime: mime, dur: dur }; })
          .then(function () { salvar(); if (document.body.contains(box)) pintar(); atualizarNav(); });
      };
      fr.readAsDataURL(blob);
    }

    btn.addEventListener('click', function () {
      if (gravacao && gravacao.rec.state === 'recording') {
        if (gravacao.qid === q.id) { gravacao.rec.stop(); }
        return;
      }
      var mime = mimeSuportado();
      if (mime === null || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        estado.className = 'estado erro';
        estado.textContent = 'Este navegador não grava áudio. Escreva a resposta abaixo ou abra o link no Chrome ou no Safari.';
        return;
      }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        var opts = { audioBitsPerSecond: 48000 }; if (mime) opts.mimeType = mime;
        var rec; try { rec = new MediaRecorder(stream, opts); } catch (e) { rec = new MediaRecorder(stream); }
        var g = { rec: rec, stream: stream, chunks: [], t0: Date.now(), qid: q.id };
        gravacao = g;
        rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) g.chunks.push(ev.data); };
        rec.onstop = function () {
          clearInterval(g.timer);
          stream.getTracks().forEach(function (t) { t.stop(); });
          var dur = (Date.now() - g.t0) / 1000;
          var tipo = rec.mimeType || mime || 'audio/webm';
          var blob = new Blob(g.chunks, { type: tipo });
          if (urlsLocais[q.id]) URL.revokeObjectURL(urlsLocais[q.id]);
          urlsLocais[q.id] = URL.createObjectURL(blob);
          urlsLocais[q.id + '_blob'] = blob;
          gravacao = null;
          tempo.textContent = fmt(dur) + ' / 3:00';
          subir(blob, tipo, dur);
        };
        rec.start(1000);
        g.timer = setInterval(function () {
          var s = (Date.now() - g.t0) / 1000;
          tempo.textContent = fmt(s) + ' / 3:00';
          if (s >= MAX_SEG) rec.stop();
        }, 250);
        pintar();
      }).catch(function () {
        estado.className = 'estado erro';
        estado.textContent = 'O microfone não foi liberado. Permita o acesso ao microfone nas configurações do navegador, ou escreva a resposta abaixo.';
      });
    });
    pintar();
    return box;
  }

  // ---------- tipos de pergunta ----------
  function campoOpcoes(q, multi) {
    var r = resp(q.id);
    if (multi && !Array.isArray(r.valor)) r.valor = [];
    var wrap = el('div', { class: 'opcoes', role: multi ? 'group' : 'radiogroup', 'aria-label': q.texto });
    var outroInput = null;
    var lista = q.opcoes.slice(); if (q.outro) lista.push(q.outro);
    function marcado(o) { return multi ? r.valor.indexOf(o) >= 0 : r.valor === o; }
    function pintar() {
      Array.prototype.forEach.call(wrap.querySelectorAll('.op'), function (b) { b.setAttribute('aria-checked', marcado(b.getAttribute('data-v')) ? 'true' : 'false'); });
      if (outroInput) outroInput.hidden = !marcado(q.outro);
    }
    lista.forEach(function (o) {
      var b = el('button', { type: 'button', class: 'op' + (multi ? ' quad' : ''), role: multi ? 'checkbox' : 'radio', 'data-v': o }, [el('span', { class: 'marc' }), el('span', { text: o })]);
      b.addEventListener('click', function () {
        if (multi) { var i = r.valor.indexOf(o); if (i >= 0) r.valor.splice(i, 1); else r.valor.push(o); }
        else r.valor = (r.valor === o ? '' : o);
        salvar(); pintar();
        if (o === q.outro && marcado(o) && outroInput) outroInput.focus();
      });
      wrap.appendChild(b);
    });
    if (q.outro) {
      outroInput = el('input', { type: 'text', class: 'outro-campo', placeholder: 'Qual?', 'aria-label': 'Especifique a opção ' + q.outro });
      outroInput.value = r.outro || '';
      outroInput.addEventListener('input', function () { r.outro = outroInput.value; salvar(); });
      wrap.appendChild(outroInput);
    }
    pintar();
    return wrap;
  }

  function campoEscala(q) {
    var r = resp(q.id);
    var wrap = el('div');
    var g = el('div', { class: 'escala', role: 'radiogroup', 'aria-label': q.texto });
    for (var i = 1; i <= 5; i++) (function (v) {
      var b = el('button', { type: 'button', role: 'radio', text: String(v), 'aria-checked': r.valor === v ? 'true' : 'false' });
      b.addEventListener('click', function () {
        r.valor = (r.valor === v ? null : v); salvar();
        Array.prototype.forEach.call(g.children, function (c, k) { c.setAttribute('aria-checked', r.valor === k + 1 ? 'true' : 'false'); });
      });
      g.appendChild(b);
    })(i);
    wrap.appendChild(g);
    wrap.appendChild(el('div', { class: 'escala-rot' }, [el('span', { text: '1 · ' + q.min }), el('span', { text: '5 · ' + q.max })]));
    return wrap;
  }

  function campoOrdenar(q) {
    var r = resp(q.id);
    if (!Array.isArray(r.ordem)) r.ordem = q.opcoes.slice();
    var ul = el('ul', { class: 'lista-ord', 'aria-label': q.texto });
    function marcar() { r.mexeu = true; salvar(); }
    function pintar() {
      ul.innerHTML = '';
      r.ordem.forEach(function (item, i) {
        var li = el('li', { 'data-i': i }, [
          el('span', { class: 'pos', text: String(i + 1) }),
          el('span', { class: 'alca', 'aria-hidden': 'true', text: '⠿' }),
          el('span', { class: 'txt', text: item }),
          el('span', { class: 'setas' }, [
            el('button', { type: 'button', 'aria-label': 'Subir ' + item, text: '▲', onclick: function () { mover(i, i - 1); } }),
            el('button', { type: 'button', 'aria-label': 'Descer ' + item, text: '▼', onclick: function () { mover(i, i + 1); } })
          ])
        ]);
        li.querySelector('.alca').addEventListener('pointerdown', function (ev) { arrastar(ev, li); });
        li.querySelector('.txt').addEventListener('pointerdown', function (ev) { if (ev.pointerType !== 'mouse' || ev.button === 0) arrastar(ev, li); });
        ul.appendChild(li);
      });
    }
    function mover(de, para) {
      if (para < 0 || para >= r.ordem.length) return;
      var it = r.ordem.splice(de, 1)[0]; r.ordem.splice(para, 0, it); marcar(); pintar();
      var b = ul.children[para] && ul.children[para].querySelector('.setas button'); if (b) b.focus();
    }
    function arrastar(ev, li) {
      ev.preventDefault();
      var de = +li.getAttribute('data-i'); var atual = de;
      li.classList.add('arrastando');
      function mov(e) {
        var itens = Array.prototype.slice.call(ul.children);
        for (var k = 0; k < itens.length; k++) {
          var rc = itens[k].getBoundingClientRect();
          if (e.clientY >= rc.top && e.clientY <= rc.bottom && k !== atual) {
            var it = r.ordem.splice(atual, 1)[0]; r.ordem.splice(k, 0, it); atual = k; pintar();
            ul.children[atual].classList.add('arrastando');
            break;
          }
        }
      }
      function fim() { document.removeEventListener('pointermove', mov); document.removeEventListener('pointerup', fim); document.removeEventListener('pointercancel', fim); marcar(); pintar(); }
      document.addEventListener('pointermove', mov);
      document.addEventListener('pointerup', fim);
      document.addEventListener('pointercancel', fim);
    }
    pintar();
    var wrap = el('div', null, [el('p', { class: 'dica', text: 'Arraste os itens ou use as setas. O 1 é o que mais pesa.' }), ul]);
    return wrap;
  }

  function campoTexto(q, longo, rotulo) {
    var r = resp(q.id);
    var c = longo ? el('textarea', { 'aria-label': rotulo || q.texto }) : el('input', { type: 'text', 'aria-label': q.texto });
    c.value = r.texto || '';
    c.addEventListener('input', function () { r.texto = c.value; salvar(); });
    if (!longo) c.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); irPara(E.tela + 1); } });
    return c;
  }

  // ---------- telas ----------
  function telaAbertura() {
    var c = el('section', { class: 'cartao' });
    c.appendChild(el('p', { class: 'olho', text: DADOS.subtitulo }));
    c.appendChild(el('h1', { text: DADOS.titulo }));
    c.appendChild(el('p', { class: 'texto', text: DADOS.abertura }));
    c.appendChild(el('p', { class: 'dica', text: 'O que você responder fica guardado neste aparelho. Se precisar parar, é só abrir o mesmo link depois e continuar de onde parou.' }));
    var chk = el('input', { type: 'checkbox', id: 'aceite' }); chk.checked = !!E.aceite;
    chk.addEventListener('change', function () { E.aceite = chk.checked; salvar(); atualizarNav(); });
    c.appendChild(el('label', { class: 'aceite', for: 'aceite' }, [chk, el('span', { text: 'Li as informações acima e aceito participar.' })]));
    c.appendChild(el('label', { class: 'rot', text: 'Autorizo que trechos curtos das minhas respostas sejam citados no relatório, sem identificação.' }));
    var g = el('div', { class: 'opcoes', role: 'radiogroup' });
    ['Sim', 'Não'].forEach(function (o) {
      var b = el('button', { type: 'button', class: 'op', role: 'radio', 'aria-checked': E.autoriza === o ? 'true' : 'false' }, [el('span', { class: 'marc' }), el('span', { text: o })]);
      b.addEventListener('click', function () {
        E.autoriza = o; salvar();
        Array.prototype.forEach.call(g.children, function (x) { x.setAttribute('aria-checked', x.textContent === o ? 'true' : 'false'); });
        atualizarNav();
      });
      g.appendChild(b);
    });
    c.appendChild(g);
    return c;
  }

  function telaPergunta(q) {
    var c = el('section', { class: 'cartao' });
    c.appendChild(el('p', { class: 'olho', text: q.secao }));
    var h = el('h2', null, [el('span', { class: 'num', text: q.id }), q.texto]);
    c.appendChild(h);
    if (q.tipo === 'um') c.appendChild(campoOpcoes(q, false));
    else if (q.tipo === 'varias') { c.appendChild(el('p', { class: 'dica', text: 'Pode marcar mais de uma.' })); c.appendChild(campoOpcoes(q, true)); }
    else if (q.tipo === 'escala') c.appendChild(campoEscala(q));
    else if (q.tipo === 'ordenar') c.appendChild(campoOrdenar(q));
    else if (q.tipo === 'curto') c.appendChild(campoTexto(q, false));
    else if (q.tipo === 'longo') c.appendChild(campoTexto(q, true));
    else if (q.tipo === 'audio') {
      c.appendChild(el('p', { class: 'dica', text: 'Grave um áudio ou escreva, como preferir. Pode fazer os dois.' }));
      c.appendChild(gravador(q));
      c.appendChild(el('label', { class: 'rot', text: 'Ou escreva aqui' }));
      c.appendChild(campoTexto(q, true, 'Resposta escrita para ' + q.id));
    }
    return c;
  }

  function resumo(q) {
    var r = E.r[q.id] || {};
    var partes = [];
    if (q.tipo === 'um' && r.valor) partes.push(r.valor === q.outro && r.outro ? q.outro + ': ' + r.outro : r.valor);
    if (q.tipo === 'varias' && r.valor && r.valor.length) partes.push(r.valor.map(function (v) { return v === q.outro && r.outro ? q.outro + ': ' + r.outro : v; }).join('; '));
    if (q.tipo === 'escala' && r.valor) partes.push(r.valor + ' (de 1 = ' + q.min + ' a 5 = ' + q.max + ')');
    if (q.tipo === 'ordenar' && r.mexeu) partes.push(r.ordem.map(function (v, i) { return (i + 1) + 'º ' + v; }).join('; '));
    if (r.texto && r.texto.trim()) partes.push(r.texto.trim());
    if (q.tipo === 'audio' && r.audio && r.audio.status === 'ok') partes.unshift('[áudio gravado]');
    return partes.join(' · ');
  }

  function pendentesAudio() {
    return perguntas.filter(function (q) { var a = (E.r[q.id] || {}).audio; return a && (a.status === 'enviando' || a.status === 'erro'); });
  }

  function telaRevisao() {
    var c = el('section', { class: 'cartao' });
    c.appendChild(el('p', { class: 'olho', text: 'Quase lá' }));
    c.appendChild(el('h2', { text: 'Confira suas respostas' }));
    c.appendChild(el('p', { class: 'dica', text: 'Toque em uma pergunta para voltar e mudar. Perguntas em branco também podem ser enviadas.' }));
    var secAtual = '';
    var lista = el('div', { class: 'revisao' });
    perguntas.forEach(function (q) {
      if (q.secao !== secAtual) { secAtual = q.secao; lista.appendChild(el('div', { class: 'sec-tit', text: q.secao })); }
      var t = resumo(q);
      lista.appendChild(el('button', { type: 'button', onclick: function () { irPara(telas.indexOf(q.id)); } }, [
        el('span', { class: 'q', text: q.id + '. ' + q.texto }),
        el('span', { class: 'r' + (t ? '' : ' vazio'), text: t || 'Sem resposta' })
      ]));
    });
    c.appendChild(lista);
    var p = pendentesAudio();
    if (p.length) c.appendChild(el('div', { class: 'aviso warn', text: 'Ainda há áudio sendo enviado ou com erro em: ' + p.map(function (q) { return q.id; }).join(', ') + '. Espere terminar ou volte à pergunta para tentar de novo.' }));
    c.appendChild(el('div', { id: 'msg-envio' }));
    return c;
  }

  function telaFeito() {
    var c = el('section', { class: 'cartao' });
    var d = el('div', { class: 'feito' });
    var selo = el('div', { class: 'selo' }); selo.innerHTML = ICON_OK;
    d.appendChild(selo);
    d.appendChild(el('h2', { text: 'Respostas enviadas. Obrigado!' }));
    d.appendChild(el('p', { class: 'texto', text: 'Suas respostas e seus áudios foram recebidos. Você já pode fechar esta página.' }));
    c.appendChild(d);
    return c;
  }

  function montarItens() {
    return perguntas.map(function (q) {
      var r = E.r[q.id] || {};
      var partes = [];
      if (q.tipo === 'um' && r.valor) partes.push(r.valor === q.outro && r.outro ? q.outro + ': ' + r.outro : r.valor);
      if (q.tipo === 'varias' && r.valor && r.valor.length) partes.push(r.valor.map(function (v) { return v === q.outro && r.outro ? q.outro + ': ' + r.outro : v; }).join('; '));
      if (q.tipo === 'escala' && r.valor) partes.push(String(r.valor));
      if (q.tipo === 'ordenar' && r.mexeu) partes.push(r.ordem.map(function (v, i) { return (i + 1) + 'º ' + v; }).join('; '));
      if (r.texto && r.texto.trim()) partes.push(r.texto.trim());
      return { id: q.id, texto: q.texto, resposta: partes.join(' | '), audio: q.tipo === 'audio' };
    });
  }

  function enviarTudo(btn) {
    var msg = document.getElementById('msg-envio');
    if (pendentesAudio().length) { msg.className = 'aviso warn'; msg.textContent = 'Espere os áudios terminarem de enviar.'; return; }
    btn.disabled = true; btn.textContent = 'Enviando…';
    var nome = '';
    var p1 = perguntas[0]; if (FORM === 'prof' && p1 && p1.tipo === 'curto') nome = ((E.r[p1.id] || {}).texto || '').trim();
    enviar({ acao: 'final', nome: nome, autoriza: E.autoriza, inicio: E.inicio, fim: new Date().toISOString(), itens: montarItens(), agente: navigator.userAgent })
      .then(function () { E.enviado = true; salvar(); irPara(telas.indexOf('feito')); })
      .catch(function () {
        btn.disabled = false; btn.textContent = 'Enviar respostas';
        msg.className = 'aviso erro';
        msg.textContent = 'Não foi possível enviar agora. Confira a internet e tente de novo. Suas respostas continuam guardadas neste aparelho.';
      });
  }

  // ---------- navegação ----------
  function podeAvancar() {
    var t = telas[E.tela];
    if (t === 'abertura') return E.aceite && !!E.autoriza;
    return true;
  }
  function atualizarNav() {
    nav.innerHTML = '';
    var t = telas[E.tela];
    if (t === 'feito') { nav.parentNode.hidden = true; return; }
    nav.parentNode.hidden = false;
    var voltar = el('button', { type: 'button', class: 'btn sec', text: 'Voltar', onclick: function () { irPara(E.tela - 1); } });
    if (E.tela === 0) voltar.style.visibility = 'hidden';
    nav.appendChild(voltar);
    nav.appendChild(el('span', { class: 'salvo', text: t === 'abertura' ? '' : 'Salvo neste aparelho' }));
    if (t === 'revisao') {
      var b = el('button', { type: 'button', class: 'btn', text: 'Enviar respostas' });
      b.addEventListener('click', function () { enviarTudo(b); });
      nav.appendChild(b);
    } else {
      var prox = el('button', { type: 'button', class: 'btn', text: t === 'abertura' ? 'Começar' : 'Próxima' });
      prox.disabled = !podeAvancar();
      prox.addEventListener('click', function () { if (podeAvancar()) irPara(E.tela + 1); });
      nav.appendChild(prox);
    }
  }
  function irPara(i) {
    if (i < 0 || i >= telas.length) return;
    if (telas[E.tela] === 'abertura' && i > 0 && !podeAvancar()) return;
    pararGravacaoSeAtiva();
    E.tela = i; salvar();
    var t = telas[i];
    main.innerHTML = '';
    var tela;
    if (t === 'abertura') tela = telaAbertura();
    else if (t === 'revisao') tela = telaRevisao();
    else if (t === 'feito') tela = telaFeito();
    else tela = telaPergunta(perguntas.filter(function (q) { return q.id === t; })[0]);
    main.appendChild(tela);
    var nPerg = perguntas.length;
    var idx = perguntas.map(function (q) { return q.id; }).indexOf(t);
    var feitoN = t === 'abertura' ? 0 : (idx >= 0 ? idx : nPerg);
    barra.style.width = (t === 'feito' ? 100 : Math.round(100 * feitoN / (nPerg + 1))) + '%';
    contador.textContent = idx >= 0 ? (idx + 1) + ' de ' + nPerg : (t === 'revisao' ? 'Revisão' : '');
    atualizarNav();
    window.scrollTo(0, 0);
    var h = main.querySelector('h1, h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  if (E.enviado) E.tela = telas.indexOf('feito');
  irPara(Math.min(E.tela || 0, telas.length - 1));
})();
