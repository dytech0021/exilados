#!/usr/bin/env bash
# Instala ou atualiza o Exilados no servidor do FilaBox. Roda como root, de dentro da pasta enviada por
# servidor/publicar.ps1 (com api/, servidor/ e site/). Pode rodar de novo: cada passo confere o que já existe,
# e nginx e MediaMTX voltam ao arquivo anterior se a mudança não passar na conferência.
set -euo pipefail

AQUI="$(cd "$(dirname "$0")/.." && pwd)"
LIVEKIT_VERSAO=1.13.7
LIVEKIT_SHA256=6634aeeb2fb1366b6723708ae4320b9d5408106a4c63457c5e845ae3979c90e2
NGINX_SITE=/etc/nginx/sites-enabled/filabox
MEDIAMTX_YML=/etc/mediamtx/mediamtx.yml

passo() { echo "== $*"; }
valor() { grep "^$1=" /etc/exilados/api.env | head -1 | cut -d= -f2-; }

[ "$(id -u)" = 0 ] || { echo "Rode como root."; exit 1; }

passo "Memória de reserva"
if ! swapon --show --noheadings | grep -q .; then
  fallocate -l 1G /swapfile-exilados && chmod 600 /swapfile-exilados && mkswap /swapfile-exilados >/dev/null
  swapon /swapfile-exilados && echo '/swapfile-exilados none swap sw 0 0' >> /etc/fstab
fi

passo "Rede"
# Buffers de UDP maiores, como o LiveKit recomenda.
printf '%s
' 'net.core.rmem_max=5000000' 'net.core.wmem_max=5000000' > /etc/sysctl.d/90-exilados.conf
sysctl -q -p /etc/sysctl.d/90-exilados.conf

passo "Segredos"
install -d -m 0700 /etc/exilados
if [ ! -f /etc/exilados/api.env ]; then
  umask 077
  sed -e "s|^LIVEKIT_CHAVE=.*|LIVEKIT_CHAVE=EX$(openssl rand -hex 8)|" \
      -e "s|^LIVEKIT_SEGREDO=.*|LIVEKIT_SEGREDO=$(openssl rand -hex 32)|" \
      -e "s|^LIVES_SEGREDO=.*|LIVES_SEGREDO=$(openssl rand -hex 32)|" \
      "$AQUI/servidor/api.env.exemplo" > /etc/exilados/api.env
  umask 022
fi
chmod 600 /etc/exilados/api.env
IP_PUBLICO="$(ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | head -1)"
( umask 077
  sed -e "s|<CHAVE>|$(valor LIVEKIT_CHAVE)|" -e "s|<SEGREDO>|$(valor LIVEKIT_SEGREDO)|" -e "s|<IP_PUBLICO>|$IP_PUBLICO|" \
      "$AQUI/servidor/livekit.yaml.exemplo" > /etc/exilados/livekit.yaml.novo )
mv /etc/exilados/livekit.yaml.novo /etc/exilados/livekit.yaml

passo "LiveKit $LIVEKIT_VERSAO"
if [ ! -x "/opt/livekit/$LIVEKIT_VERSAO/livekit-server" ]; then
  TMP="$(mktemp -d)"
  curl -fsSL -o "$TMP/livekit.tar.gz" \
    "https://github.com/livekit/livekit/releases/download/v$LIVEKIT_VERSAO/livekit_${LIVEKIT_VERSAO}_linux_amd64.tar.gz"
  echo "$LIVEKIT_SHA256  $TMP/livekit.tar.gz" | sha256sum -c --quiet -
  install -d "/opt/livekit/$LIVEKIT_VERSAO"
  tar -xzf "$TMP/livekit.tar.gz" -C "/opt/livekit/$LIVEKIT_VERSAO" livekit-server
  chown -R root:root "/opt/livekit/$LIVEKIT_VERSAO"
  rm -rf "$TMP"
fi

passo "exilados-api"
install -d /opt/exilados
rm -rf /opt/exilados/api.novo /opt/exilados/api.antigo
cp -r "$AQUI/api" /opt/exilados/api.novo
rm -rf /opt/exilados/api.novo/test
chown -R root:root /opt/exilados/api.novo && chmod -R a+rX,go-w /opt/exilados/api.novo
[ -d /opt/exilados/api ] && mv /opt/exilados/api /opt/exilados/api.antigo
mv /opt/exilados/api.novo /opt/exilados/api

passo "Serviços"
install -m 0644 "$AQUI/servidor/livekit.service" /etc/systemd/system/exilados-livekit.service
install -m 0644 "$AQUI/servidor/exilados-api.service" /etc/systemd/system/exilados-api.service
systemctl daemon-reload
systemctl enable --quiet exilados-livekit exilados-api
systemctl restart exilados-livekit exilados-api
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null http://127.0.0.1:7415/saude 2>/dev/null && break
  sleep 0.5
done
curl -fsS -o /dev/null http://127.0.0.1:7415/saude || { journalctl -u exilados-api -n 30 --no-pager; exit 1; }
systemctl is-active --quiet exilados-livekit || { journalctl -u exilados-livekit -n 30 --no-pager; exit 1; }

passo "Site"
install -d /var/www/exilados/www /var/www/exilados/atualizacao
rm -rf /var/www/exilados/www/exilados.novo /var/www/exilados/www/exilados.antigo
cp -r "$AQUI/site" /var/www/exilados/www/exilados.novo
rm -rf /var/www/exilados/www/exilados.novo/test /var/www/exilados/www/exilados.novo/package.json
chown -R root:root /var/www/exilados/www/exilados.novo && chmod -R a+rX,go-w /var/www/exilados/www/exilados.novo
[ -d /var/www/exilados/www/exilados ] && mv /var/www/exilados/www/exilados /var/www/exilados/www/exilados.antigo
mv /var/www/exilados/www/exilados.novo /var/www/exilados/www/exilados
rm -rf /var/www/exilados/www/exilados.antigo

passo "nginx"
install -m 0644 "$AQUI/servidor/nginx-exilados.conf" /etc/nginx/snippets/exilados.conf
if ! grep -q 'snippets/exilados.conf' "$NGINX_SITE"; then
  cp "$NGINX_SITE" /etc/nginx/filabox.antes-exilados
  # A linha entra antes do primeiro "location / {" (o do bloco de filabox3d.com.br).
  awk '!feito && /^    location \/ \{/ { print "    include /etc/nginx/snippets/exilados.conf;\n"; feito = 1 } { print }' \
    /etc/nginx/filabox.antes-exilados > "$NGINX_SITE"
fi
if ! nginx -t 2>/tmp/exilados-nginx.txt; then
  cat /tmp/exilados-nginx.txt
  [ -f /etc/nginx/filabox.antes-exilados ] && cp /etc/nginx/filabox.antes-exilados "$NGINX_SITE"
  rm -f /etc/nginx/snippets/exilados.conf
  nginx -t && systemctl reload nginx
  echo "A configuração do nginx não passou; voltei à anterior."
  exit 1
fi
systemctl reload nginx

passo "MediaMTX"
# O MediaMTX relê o arquivo sozinho, e trocar a autorização derruba as lives no ar: com alguma live acontecendo,
# a mudança fica para a próxima publicação (ou FORCAR_MEDIAMTX=1).
NOVO=/tmp/exilados-mediamtx.yml
ANTERIOR=/tmp/exilados-mediamtx-anterior.yml
cp "$MEDIAMTX_YML" "$NOVO"
sed -i 's|^authHTTPAddress: http://127.0.0.1:7414/mediamtx/auth$|authHTTPAddress: http://127.0.0.1:7416/mediamtx/auth|' "$NOVO"
if ! grep -qF '"~^ex/' "$NOVO"; then
  [ -n "$(tail -c1 "$NOVO")" ] && echo >> "$NOVO"
  printf '%s\n' '  # Lives do Exilados (o caminho é sorteado pelo exilados-api).' '  "~^ex/[A-Za-z0-9]{24}$":' >> "$NOVO"
fi
NO_AR="$(curl -fsS http://127.0.0.1:9997/v3/paths/list 2>/dev/null | grep -o '"itemCount":[0-9]*' | cut -d: -f2 || true)"
if cmp -s "$MEDIAMTX_YML" "$NOVO"; then
  echo "Já configurado."
elif [ "${NO_AR:-0}" != 0 ] && [ "${FORCAR_MEDIAMTX:-0}" != 1 ]; then
  echo "AVISO: $NO_AR live(s) no ar agora; a mudança do MediaMTX fica para a próxima publicação."
else
  [ -f /etc/mediamtx/mediamtx.yml.antes-exilados ] || cp "$MEDIAMTX_YML" /etc/mediamtx/mediamtx.yml.antes-exilados
  cp "$MEDIAMTX_YML" "$ANTERIOR"
  cp "$NOVO" "$MEDIAMTX_YML"
  systemctl restart mediamtx
  sleep 2
  if ! systemctl is-active --quiet mediamtx || ! curl -fsS -o /dev/null http://127.0.0.1:9997/v3/paths/list; then
    journalctl -u mediamtx -n 20 --no-pager
    cp "$ANTERIOR" "$MEDIAMTX_YML"
    systemctl restart mediamtx
    echo "O MediaMTX não subiu com a configuração nova; voltei à anterior."
    exit 1
  fi
fi
rm -f "$NOVO" "$ANTERIOR" /tmp/exilados-nginx.txt

passo "Pronto"
curl -fsS https://filabox3d.com.br/exilados/api/saude && echo
