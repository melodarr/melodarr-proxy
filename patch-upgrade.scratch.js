const fs = require('fs');

function patchFile(file) {
  let content = fs.readFileSync(file, 'utf8');
  
  if (!content.includes('DOCKER_COMPOSE=')) {
    const dccheck = `
# Determine docker compose command
if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE="docker-compose"
else
  echo "Error: Neither 'docker compose' nor 'docker-compose' found"
  exit 1
fi
`;
    content = content.replace(/^#!\/bin\/(bash|sh|usr\/bin\/env bash)\n/m, `$&${dccheck}`);
  }

  content = content.replace(/docker compose/g, '"$DOCKER_COMPOSE"');
  // Revert specific cases where it got double quoted if we ran it multiple times
  content = content.replace(/"\$DOCKER_COMPOSE" version/g, 'docker compose version'); // Keep the check itself
  content = content.replace(/"\$DOCKER_COMPOSE" ps/g, '$DOCKER_COMPOSE ps');
  content = content.replace(/"\$DOCKER_COMPOSE" config/g, '$DOCKER_COMPOSE config');
  content = content.replace(/"\$DOCKER_COMPOSE" pull/g, '$DOCKER_COMPOSE pull');
  content = content.replace(/"\$DOCKER_COMPOSE" up/g, '$DOCKER_COMPOSE up');
  
  fs.writeFileSync(file, content);
  console.log(`Patched ${file}`);
}

patchFile('scripts/melodarr-update.sh');
patchFile('scripts/upgrade-proxmox-lxc.sh');
