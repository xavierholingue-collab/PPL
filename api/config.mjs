// @ts-check
/**
 * Configuration de l'API, lue dans l'environnement (fichier /etc/ppl/env sur
 * le serveur, chargé par systemd).
 *
 * L'API REFUSE DE DÉMARRER si un réglage indispensable manque ou ne tient
 * pas debout. Un service qui démarrerait sans mot de passe ou avec un secret
 * de session vide ouvrirait la saisie à n'importe qui — mieux vaut un échec
 * bruyant au démarrage qu'une porte ouverte en silence.
 *
 * Les réglages PostgreSQL (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE)
 * sont lus directement par le pilote pg.
 */

/**
 * @typedef {{
 *   hote: string, port: number, motDePasse: string, secret: string,
 *   origine: string, environnement: 'local' | 'maquette' | 'production',
 *   derriereProxy: boolean, cookieSecurise: boolean, dureeSessionJours: number
 * }} Config
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Config}
 */
export function lireConfig(env = process.env) {
  /** @type {string[]} */
  const erreurs = [];

  const port = Number(env.PORT ?? 3020);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) erreurs.push('PORT invalide');

  // L'API n'écoute que sur la machine : on ne l'atteint que par Caddy.
  const hote = env.HOTE ?? '127.0.0.1';

  const motDePasse = env.MOT_DE_PASSE ?? '';
  if (motDePasse.length < 10) erreurs.push('MOT_DE_PASSE absent ou trop court (10 caractères au moins)');

  const secret = env.SECRET_SESSION ?? '';
  if (secret.length < 32) erreurs.push('SECRET_SESSION absent ou trop court (32 caractères au moins)');

  const environnement = env.ENVIRONNEMENT ?? 'local';
  if (!['local', 'maquette', 'production'].includes(environnement)) {
    erreurs.push('ENVIRONNEMENT doit valoir local, maquette ou production');
  }

  const derriereProxy = env.DERRIERE_PROXY === '1';
  const origine = (env.ORIGINE ?? '').replace(/\/+$/, '');
  if (origine && !/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origine)) erreurs.push('ORIGINE mal formée');
  if (derriereProxy && !origine.startsWith('https://')) {
    erreurs.push('derrière le proxy, ORIGINE doit être l’adresse https du site');
  }

  const dureeSessionJours = Number(env.DUREE_SESSION_JOURS ?? 60);
  if (!Number.isInteger(dureeSessionJours) || dureeSessionJours < 1 || dureeSessionJours > 365) {
    erreurs.push('DUREE_SESSION_JOURS doit être un entier entre 1 et 365');
  }

  if (erreurs.length > 0) {
    throw new Error(`configuration incomplète :\n  - ${erreurs.join('\n  - ')}`);
  }

  return {
    hote,
    port,
    motDePasse,
    secret,
    origine,
    environnement: /** @type {Config['environnement']} */ (environnement),
    derriereProxy,
    cookieSecurise: origine.startsWith('https://'),
    dureeSessionJours,
  };
}
