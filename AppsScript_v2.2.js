// ============================================
// ENVIO DE E-MAILS POR FILIAL — v2.3
// ============================================
// Mudanças v2.3:
// - Removidas mensagens de "confirme o recebimento" dos e-mails
// - Removido bloco "Certifique-se" e "CD de origem"
// - Rodapé simplificado
// ============================================

const MODO_TESTE = false;
const EMAIL_TESTE = "joao.marques@magazineluiza.com.br";
const EMAIL_RESPONSAVEL = "joao.marques@magazineluiza.com.br";

const PDF_TUTORIAL_ID = "1_v6PqMLF_upapvqT1IDpaM8igr6Glo0D";
const PDF_NOME_ARQUIVO = "Tutorial - Aceite de Recebimento.pdf";

// ============================================
// ENTRY POINTS
// ============================================

function doPost(e) {
  try {
    var body = null;

    // Tenta ler o body de diferentes formas (fetch JSON, XHR text/plain, FormData)
    if (e.postData && e.postData.contents && e.postData.contents.length > 0) {
      try {
        body = JSON.parse(e.postData.contents);
      } catch (_) {
        // Pode vir como URL-encoded ou multipart — tenta como string JSON mesmo
        body = JSON.parse(decodeURIComponent(e.postData.contents));
      }
    }

    // FormData manda como e.parameter.payload
    if (!body && e.parameter && e.parameter.payload) {
      body = JSON.parse(e.parameter.payload);
    }

    if (!body) return respJson({ ok: false, erro: "Body vazio ou formato inválido" });
    if (body.acao === "enviarEmails") return enviarEmailsParaFiliais(body);
    return respJson({ ok: false, erro: "Acao desconhecida: " + body.acao });
  } catch (err) {
    return respJson({ ok: false, erro: err.message });
  }
}

// Fallback GET — extensão manda ?acao=enviarEmails&filiais=100,200&carga=999...
function doGet(e) {
  try {
    var p = e.parameter || {};
    if (p.acao !== "enviarEmails") return respJson({ ok: false, erro: "GET só suporta acao=enviarEmails" });

    var dados = {
      acao: "enviarEmails",
      filiais: p.filiais ? p.filiais.split(",").map(function(f){ return f.trim(); }) : [],
      carga: p.carga || "",
      freightType: p.freightType || "DEDICATED",
      departureDate: p.departureDate || "",
      rastreios: {},
      itensPorFilial: {}
    };

    if (!dados.filiais.length) return respJson({ ok: false, erro: "Nenhuma filial informada via GET" });
    return enviarEmailsParaFiliais(dados);
  } catch (err) {
    return respJson({ ok: false, erro: err.message });
  }
}

function respJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// PDF
// ============================================

function obterPdfAnexo() {
  try {
    var arquivo = DriveApp.getFileById(PDF_TUTORIAL_ID);
    return arquivo.getBlob().setName(PDF_NOME_ARQUIVO);
  } catch (err) {
    console.log("⚠️ PDF não encontrado: " + err.message);
    return null;
  }
}

// ============================================
// HELPERS
// ============================================

function padFilial(filial) {
  var num = String(filial).replace(/\D/g, '').replace(/^0+/, '');
  if (num === '') return '000';
  var n = parseInt(num, 10);
  if (n < 10)  return '00' + n;
  if (n < 100) return '0' + n;
  return String(n);
}

function gerarEmailsFilial(filial) {
  var padded = padFilial(filial);
  return {
    gerente:        'gerente' + padded + '@gmail.com',
    lidercomercial: 'lidercomercial' + padded + '@gmail.com',
    estoquista:     'estoquista' + padded + '@gmail.com'
  };
}

// ============================================
// TEMPLATE — EMAIL PARA FILIAL
// ============================================

function montarEmailFilial(filialPadded, carga, freteLabel, dataFormatada, rastreio, itens) {
  var tabelaItens = '';
  if (itens && itens.length > 0) {
    var linhasItens = '';
    for (var i = 0; i < itens.length; i++) {
      var bgItem = i % 2 === 0 ? '#fafbfc' : '#ffffff';
      linhasItens +=
        '<tr style="background:' + bgItem + ';">' +
          '<td style="padding:12px 20px;font-size:14px;color:#1a1a2e;border-bottom:1px solid #eef1f6;">' + itens[i].produto + '</td>' +
          '<td style="padding:12px 20px;font-size:14px;color:#1a1a2e;font-weight:700;text-align:center;border-bottom:1px solid #eef1f6;">' + itens[i].qtd + '</td>' +
        '</tr>';
    }
    tabelaItens =
      '<tr><td style="padding:0 40px 24px 40px;">' +
        '<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">' +
          '<thead><tr style="background:linear-gradient(135deg,#0066cc,#0052a3);">' +
            '<th style="padding:12px 20px;color:#fff;font-size:12px;text-transform:uppercase;letter-spacing:0.8px;text-align:left;font-weight:600;">Produto</th>' +
            '<th style="padding:12px 20px;color:#fff;font-size:12px;text-transform:uppercase;letter-spacing:0.8px;text-align:center;font-weight:600;">Qtd</th>' +
          '</tr></thead>' +
          '<tbody>' + linhasItens + '</tbody>' +
        '</table>' +
      '</td></tr>';
  }

  var blocoRastreio = '';
  if (rastreio) {
    blocoRastreio =
      '<tr><td style="padding:0 40px 24px 40px;">' +
        '<table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;overflow:hidden;">' +
          '<tr><td style="padding:16px 20px;">' +
            '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
              '<td style="width:40px;vertical-align:top;font-size:24px;">📮</td>' +
              '<td>' +
                '<p style="margin:0 0 2px 0;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:#92400e;font-weight:600;">Código de Rastreio</p>' +
                '<p style="margin:0;font-size:18px;font-family:\'Courier New\',monospace;color:#78350f;font-weight:700;letter-spacing:1px;">' + rastreio + '</p>' +
              '</td>' +
            '</tr></table>' +
          '</td></tr>' +
        '</table>' +
      '</td></tr>';
  }

  var blocoAceite =
    '<tr><td style="padding:0 40px 24px 40px;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#fefce8,#fef9c3);border:2px solid #facc15;border-radius:10px;overflow:hidden;">' +
        '<tr><td style="padding:20px;">' +
          '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
            '<td style="width:44px;vertical-align:top;font-size:28px;">⚠️</td>' +
            '<td>' +
              '<p style="margin:0 0 6px 0;font-size:15px;font-weight:700;color:#854d0e;">Ação Necessária: Aceite de Recebimento</p>' +
              '<p style="margin:0;font-size:14px;color:#713f12;line-height:1.7;">Ao receber os produtos, é <strong>obrigatório</strong> realizar o aceite de recebimento no <strong>Gestor de Ativos</strong>.</p>' +
              '<p style="margin:10px 0 0 0;font-size:13px;color:#92400e;line-height:1.6;">📎 <strong>Tutorial em anexo</strong> com o passo a passo completo.</p>' +
            '</td>' +
          '</tr></table>' +
        '</td></tr>' +
      '</table>' +
    '</td></tr>';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;padding:0;background:#f0f2f5;font-family:\'Segoe UI\',Helvetica,Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:40px 20px;"><tr><td align="center">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">' +

    '<tr><td style="background:linear-gradient(135deg,#0077e6 0%,#004999 100%);padding:36px 40px 32px 40px;">' +
      '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
        '<td>' +
          '<p style="margin:0 0 8px 0;font-size:13px;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,0.7);font-weight:600;">Gestão de Ativos</p>' +
          '<h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">Carga Finalizada</h1>' +
          '<p style="margin:10px 0 0 0;color:rgba(255,255,255,0.85);font-size:15px;">Os produtos foram separados e o envio está confirmado.</p>' +
        '</td>' +
        '<td style="width:70px;vertical-align:top;text-align:right;"><div style="width:56px;height:56px;background:rgba(255,255,255,0.15);border-radius:14px;display:inline-block;text-align:center;line-height:56px;font-size:28px;">📦</div></td>' +
      '</tr></table>' +
    '</td></tr>' +

    '<tr><td style="padding:32px 40px 24px 40px;">' +
      '<p style="margin:0;font-size:16px;color:#1a1a2e;">Olá, <strong>Equipe da Filial ' + filialPadded + '</strong>!</p>' +
      '<p style="margin:8px 0 0 0;font-size:14px;color:#64748b;line-height:1.7;">A carga foi concluída via <strong style="color:#1a1a2e;">' + freteLabel + '</strong>. Confira os detalhes:</p>' +
    '</td></tr>' +

    '<tr><td style="padding:0 40px 24px 40px;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">' +
        '<tr><td style="padding:20px;border-bottom:1px solid #e2e8f0;background:linear-gradient(135deg,#f0f7ff,#e8f0fe);">' +
          '<p style="margin:0 0 4px 0;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:#64748b;font-weight:600;">Número da Carga</p>' +
          '<p style="margin:0;font-size:28px;font-weight:800;color:#0066cc;">#' + carga + '</p>' +
        '</td></tr>' +
        '<tr><td style="padding:0;">' +
          '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
            '<td width="50%" style="padding:16px 20px;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">' +
              '<p style="margin:0 0 4px 0;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:#64748b;font-weight:600;">Filial Destino</p>' +
              '<p style="margin:0;font-size:16px;font-weight:700;color:#1a1a2e;">' + filialPadded + '</p>' +
            '</td>' +
            '<td width="50%" style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">' +
              '<p style="margin:0 0 4px 0;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:#64748b;font-weight:600;">Modalidade</p>' +
              '<p style="margin:0;font-size:16px;font-weight:700;color:#1a1a2e;">' + freteLabel + '</p>' +
            '</td>' +
          '</tr></table>' +
        '</td></tr>' +
        '<tr><td style="padding:16px 20px;">' +
          '<p style="margin:0 0 4px 0;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:#64748b;font-weight:600;">Data Prevista de Saída</p>' +
          '<p style="margin:0;font-size:16px;font-weight:700;color:#1a1a2e;">📅 ' + dataFormatada + '</p>' +
        '</td></tr>' +
      '</table>' +
    '</td></tr>' +

    blocoRastreio +
    tabelaItens +
    blocoAceite +

    '<tr><td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">' +
      '<p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">Magazine Luiza — Gestão de Ativos<br><span style="color:#cbd5e1;">E-mail automático</span></p>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>';
}

// ============================================
// TEMPLATE — EMAIL DE RELATÓRIO (igual à v2.1)
// ============================================

function montarEmailRelatorio(carga, freteLabel, dataFormatada, resultados) {
  var totalOk = 0, totalErro = 0, linhas = '';
  for (var i = 0; i < resultados.length; i++) {
    var r = resultados[i], ok = r.status === 'ok';
    if (ok) totalOk++; else totalErro++;
    var bgLinha = ok ? (i % 2 === 0 ? '#f8fafc' : '#ffffff') : '#fef2f2';
    var statusBadge = ok
      ? '<span style="display:inline-block;background:#dcfce7;color:#166534;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;">ENVIADO</span>'
      : '<span style="display:inline-block;background:#fee2e2;color:#991b1b;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;">ERRO</span>';
    var itensTexto = '';
    if (r.itens && r.itens.length > 0) {
      var parts = [];
      for (var j = 0; j < r.itens.length; j++) parts.push(r.itens[j].qtd + 'x ' + r.itens[j].produto);
      itensTexto = '<span style="font-size:12px;color:#475569;">' + parts.join('<br>') + '</span>';
    } else { itensTexto = '<span style="font-size:12px;color:#cbd5e1;">—</span>'; }
    var destinoTexto = ok
      ? '<span style="font-size:11px;color:#475569;word-break:break-all;">' + (r.emails||[]).join('<br>') + '</span>'
      : '<span style="font-size:11px;color:#dc2626;font-weight:600;">' + r.erro + '</span>';
    var rastreioTexto = r.rastreio ? '<br><span style="font-size:10px;color:#78350f;font-family:\'Courier New\',monospace;background:#fef3c7;padding:2px 6px;border-radius:4px;">📮 ' + r.rastreio + '</span>' : '';
    linhas += '<tr style="background:' + bgLinha + ';">' +
      '<td style="padding:14px 16px;border-bottom:1px solid #f1f5f9;"><strong style="font-size:14px;color:#1e293b;">' + r.filial + '</strong>' + rastreioTexto + '</td>' +
      '<td style="padding:14px 16px;border-bottom:1px solid #f1f5f9;">' + itensTexto + '</td>' +
      '<td style="padding:14px 16px;border-bottom:1px solid #f1f5f9;">' + destinoTexto + '</td>' +
      '<td style="padding:14px 16px;border-bottom:1px solid #f1f5f9;text-align:center;">' + statusBadge + '</td>' +
    '</tr>';
  }
  var taxa = resultados.length > 0 ? Math.round((totalOk / resultados.length) * 100) : 0;
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;padding:0;background:#f0f2f5;font-family:\'Segoe UI\',Helvetica,Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:40px 20px;"><tr><td align="center">' +
    '<table width="700" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">' +
    '<tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:36px 40px;">' +
      '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
        '<td><p style="margin:0 0 8px 0;font-size:11px;text-transform:uppercase;letter-spacing:2.5px;color:#64748b;font-weight:600;">Relatório de Envio</p>' +
          '<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Carga #' + carga + '</h1>' +
          '<p style="margin:10px 0 0 0;font-size:14px;color:#94a3b8;">' + freteLabel + ' &nbsp;•&nbsp; ' + dataFormatada + '</p></td>' +
        '<td style="width:60px;text-align:right;"><div style="width:48px;height:48px;background:rgba(255,255,255,0.08);border-radius:12px;display:inline-block;text-align:center;line-height:48px;font-size:24px;">📊</div></td>' +
      '</tr></table>' +
    '</td></tr>' +
    '<tr><td><table width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td width="33%" style="padding:20px;text-align:center;border-bottom:2px solid #e2e8f0;border-right:1px solid #e2e8f0;"><p style="margin:0;font-size:28px;font-weight:800;color:#1e293b;">' + resultados.length + '</p><p style="margin:4px 0 0 0;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:600;">Total</p></td>' +
      '<td width="33%" style="padding:20px;text-align:center;border-bottom:2px solid #e2e8f0;border-right:1px solid #e2e8f0;"><p style="margin:0;font-size:28px;font-weight:800;color:#16a34a;">' + totalOk + '</p><p style="margin:4px 0 0 0;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:600;">Enviados</p></td>' +
      '<td width="34%" style="padding:20px;text-align:center;border-bottom:2px solid #e2e8f0;"><p style="margin:0;font-size:28px;font-weight:800;color:' + (totalErro > 0 ? '#dc2626' : '#94a3b8') + ';">' + totalErro + '</p><p style="margin:4px 0 0 0;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:600;">Com Erro</p></td>' +
    '</tr></table></td></tr>' +
    '<tr><td style="padding:24px 40px 8px 40px;">' +
      '<p style="margin:0 0 8px 0;font-size:12px;color:#64748b;font-weight:600;">Taxa de Sucesso: <strong style="color:' + (taxa===100?'#16a34a':'#f59e0b') + ';">' + taxa + '%</strong></p>' +
      '<div style="background:#e2e8f0;border-radius:6px;height:8px;overflow:hidden;"><div style="background:' + (taxa===100?'linear-gradient(90deg,#22c55e,#16a34a)':'linear-gradient(90deg,#f59e0b,#eab308)') + ';height:100%;width:' + taxa + '%;border-radius:6px;"></div></div>' +
    '</td></tr>' +
    '<tr><td style="padding:16px 40px 32px 40px;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">' +
        '<thead><tr style="background:#1e293b;">' +
          '<th style="padding:12px 16px;color:#e2e8f0;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;text-align:left;font-weight:600;">Filial</th>' +
          '<th style="padding:12px 16px;color:#e2e8f0;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;text-align:left;font-weight:600;">Itens</th>' +
          '<th style="padding:12px 16px;color:#e2e8f0;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;text-align:left;font-weight:600;">Enviado para</th>' +
          '<th style="padding:12px 16px;color:#e2e8f0;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;text-align:center;font-weight:600;">Status</th>' +
        '</tr></thead>' +
        '<tbody>' + linhas + '</tbody>' +
      '</table>' +
    '</td></tr>' +
    '<tr><td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">' +
      '<p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">Magazine Luiza — Gestão de Ativos — Relatório Automático<br>' +
      '<span style="color:#cbd5e1;">Gerado em ' + Utilities.formatDate(new Date(), "America/Sao_Paulo", "dd/MM/yyyy 'às' HH:mm") + '</span></p>' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';
}

// ============================================
// ENVIO PRINCIPAL
// ============================================

function enviarEmailsParaFiliais(dados) {
  var filiais        = dados.filiais || [];
  var carga          = dados.carga || "";
  var freightType    = dados.freightType || "DEDICATED";
  var departureDate  = dados.departureDate || "";
  var rastreios      = dados.rastreios || {};
  var itensPorFilial = dados.itensPorFilial || {};

  var dataFormatada = departureDate || "Data não informada";
  try {
    dataFormatada = Utilities.formatDate(new Date(departureDate), "America/Sao_Paulo", "dd/MM/yyyy 'às' HH:mm");
  } catch(e) {}

  var freteLabel = freightType === "CORREIOS" ? "Correios" : "Dedicado";
  var resultados = [];
  var pdfAnexo = obterPdfAnexo();

  console.log("🚀 Carga #" + carga + " | " + filiais.length + " filial(is) | " + (MODO_TESTE ? "TESTE" : "PRODUÇÃO"));

  for (var f = 0; f < filiais.length; f++) {
    var filial       = filiais[f];
    var filialPadded = padFilial(filial);
    // A extensão manda rastreios com chave normalizada (sem zeros à esquerda)
    // mas faz lookup em todas as variações por segurança
    var _fn = String(filial).replace(/\D/g, '');
    var _norm = _fn.replace(/^0+/, '') || '0';
    var rastreio = rastreios[_norm]
      || rastreios[filial]
      || rastreios[filialPadded]
      || rastreios[_fn]
      || rastreios[_norm.padStart(3,'0')]
      || rastreios[_norm.padStart(4,'0')]
      || rastreios[_norm.padStart(5,'0')]
      || null;
    console.log('Filial ' + _norm + ' | rastreio: ' + rastreio + ' | chaves disponíveis: ' + Object.keys(rastreios).join(','));
    var itens        = itensPorFilial[filial] || itensPorFilial[String(filial).replace(/^0+/, '')] || [];
    var contatos     = gerarEmailsFilial(filial);

    var emailsValidos = MODO_TESTE
      ? [EMAIL_TESTE]
      : [contatos.gerente, contatos.lidercomercial, contatos.estoquista];

    var assunto = MODO_TESTE
      ? "[TESTE] Carga #" + carga + " — Filial " + filialPadded
      : "Carga #" + carga + " pronta para envio — Filial " + filialPadded;

    var html = montarEmailFilial(filialPadded, carga, freteLabel, dataFormatada, rastreio, itens);
    var emailOptions = {
      to: emailsValidos.join(","),
      subject: assunto,
      htmlBody: html,
      replyTo: EMAIL_RESPONSAVEL
    };
    if (pdfAnexo) emailOptions.attachments = [pdfAnexo];

    try {
      MailApp.sendEmail(emailOptions);
      console.log("📧 Filial " + filialPadded + " → OK");
      resultados.push({ filial: filialPadded, status: 'ok', itens: itens, rastreio: rastreio, emails: emailsValidos });
    } catch(err) {
      console.log("❌ Filial " + filialPadded + " — " + err.message);
      resultados.push({ filial: filialPadded, status: 'erro', erro: err.message, itens: itens, rastreio: rastreio, emails: emailsValidos });
    }
  }

  // Relatório pro responsável
  try {
    var envCount = resultados.filter(function(r){ return r.status === 'ok'; }).length;
    MailApp.sendEmail({
      to: EMAIL_RESPONSAVEL,
      subject: "📊 Relatório — Carga #" + carga + " | " + envCount + "/" + filiais.length + " enviados",
      htmlBody: montarEmailRelatorio(carga, freteLabel, dataFormatada, resultados)
    });
  } catch(err) { console.log("⚠️ Relatório falhou: " + err.message); }

  var enviados = resultados.filter(function(r){ return r.status === 'ok'; }).map(function(r){ return r.filial; });
  var erros    = resultados.filter(function(r){ return r.status !== 'ok'; }).map(function(r){ return { filial: r.filial, erro: r.erro }; });
  return respJson({ ok: true, enviados: enviados, erros: erros });
}

// ============================================
// FUNÇÕES DE TESTE
// ============================================

function testarEnvioCompleto() {
  var dadosFake = {
    filiais: ["344", "10", "1", "1000"],
    carga: "9999",
    freightType: "CORREIOS",
    departureDate: new Date().toISOString(),
    rastreios: { "344": "OY666495229BR", "10": "OY777888999BR" },
    itensPorFilial: {
      "344":  [{ produto: "Monitor 24pol", qtd: 2 }, { produto: "Notebook Dell", qtd: 1 }],
      "10":   [{ produto: "TC500", qtd: 5 }],
      "1":    [{ produto: "Impressora HP", qtd: 3 }],
      "1000": [{ produto: "Teclado USB", qtd: 10 }, { produto: "Mouse Sem Fio", qtd: 10 }]
    }
  };
  var resultado = enviarEmailsParaFiliais(dadosFake);
  console.log(resultado.getContent());
}

function testarEnvioDedicado() {
  var dadosFake = {
    filiais: ["550", "100"],
    carga: "8888",
    freightType: "DEDICATED",
    departureDate: new Date().toISOString(),
    rastreios: {},
    itensPorFilial: {
      "550": [{ produto: "Cadeira Gamer", qtd: 4 }],
      "100": [{ produto: "Mesa de Escritório", qtd: 2 }]
    }
  };
  var resultado = enviarEmailsParaFiliais(dadosFake);
  console.log(resultado.getContent());
}
