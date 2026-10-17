#!/usr/bin/env python3
"""Serveur de prévisualisation d'Agora Factures (développement uniquement).

Reprend le comportement de « python3 -m http.server » en ajoutant ce qui est
indispensable pour tester une application web progressive :

  • Cache-Control: no-store sur le HTML, le JS, le CSS, le manifeste et
    sw.js  -> aucune ressource périmée ne perturbe les essais hors ligne ;
  • Service-Worker-Allowed: /  -> le worker peut piloter tout le site ;
  • HTTP/1.1 avec connexions persistances et traitement multithread ;
  • types MIME corrects pour .js, .mjs, .json, .webmanifest et .svg ;
  • journalisation sobre sur la sortie standard.

Aucune dépendance : bibliothèque standard Python uniquement.

Usage :
    python3 tools/serveur-dev.py [port]        # port 8080 par défaut
"""

import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
# Racine du site = dossier parent de tools/ (le dépôt sert de racine web).
RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Ressources qui ne doivent jamais être mises en cache pendant le développement.
SANS_CACHE = ('.html', '.js', '.mjs', '.css', '.json', '.webmanifest')


class Gestionnaire(SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler avec en-têtes adaptés à une PWA."""

    protocol_version = 'HTTP/1.1'
    server_version = 'AgoraFactures-Preview/1.0'
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.json': 'application/json',
        '.webmanifest': 'application/manifest+json',
        '.svg': 'image/svg+xml',
    }

    def end_headers(self):
        chemin = self.translate_path(self.path)
        if chemin.endswith(SANS_CACHE):
            self.send_header('Cache-Control', 'no-store, must-revalidate')
        if chemin.endswith('sw.js'):
            self.send_header('Service-Worker-Allowed', '/')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def log_message(self, format, *args):
        sys.stdout.write('%s - %s\n' % (self.address_string(), format % args))
        sys.stdout.flush()


def main():
    serveur = ThreadingHTTPServer(('0.0.0.0', PORT), partial(Gestionnaire, directory=RACINE))
    print('Agora Factures — aperçu sur http://0.0.0.0:%d/ (racine : %s)' % (PORT, RACINE))
    sys.stdout.flush()
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        serveur.server_close()


if __name__ == '__main__':
    main()
