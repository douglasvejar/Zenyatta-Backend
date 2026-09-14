// =================================================================
// DICCIONARIO DE EQUIPOS (MLB + NFL, más apodos en español y locales)
// =================================================================
// Portado tal cual del app.js original (sección 1). Este es el
// diccionario BASE, compartido por todos los grupos. Cada grupo puede
// agregar sus propios apodos extra (tabla equipos_personalizados) — ver
// mezclarConPersonalizados() más abajo, mismo comportamiento que el merge
// que ya hacía la app original con localStorage.
//
// PRÁCTICA ESTÁNDAR (a pedido explícito del usuario, 28-08-2026): cada vez
// que se conecta la API de un deporte nuevo (ver src/services/nflApi.js
// como ejemplo), el diccionario de equipos de ESE deporte se agrega ACÁ
// mismo, en la MISMA entrega — nunca se deja para después. Hoy cubre los
// 30 equipos de MLB y los 32 de NFL; NHL y fútbol quedan pendientes hasta
// que se conecten sus APIs (ver "Pendientes" en el doc de proyecto).
const DICCIONARIO_EQUIPOS_BASE = {
  'astros': { nombre: 'Houston Astros', deporte: 'mlb' },
  'houston': { nombre: 'Houston Astros', deporte: 'mlb' },
  'phillies': { nombre: 'Philadelphia Phillies', deporte: 'mlb' },
  'filadelfia': { nombre: 'Philadelphia Phillies', deporte: 'mlb' },
  'philadelphia': { nombre: 'Philadelphia Phillies', deporte: 'mlb' },
  'red sox': { nombre: 'Boston Red Sox', deporte: 'mlb' },
  'boston': { nombre: 'Boston Red Sox', deporte: 'mlb' },
  'yankees': { nombre: 'New York Yankees', deporte: 'mlb' },
  'rays': { nombre: 'Tampa Bay Rays', deporte: 'mlb' },
  'tampa': { nombre: 'Tampa Bay Rays', deporte: 'mlb' },
  'twins': { nombre: 'Minnesota Twins', deporte: 'mlb' },
  'minnesota': { nombre: 'Minnesota Twins', deporte: 'mlb' },
  'minesota': { nombre: 'Minnesota Twins', deporte: 'mlb' },
  'dodgers': { nombre: 'Los Angeles Dodgers', deporte: 'mlb' },
  'orioles': { nombre: 'Baltimore Orioles', deporte: 'mlb' },
  'baltimore': { nombre: 'Baltimore Orioles', deporte: 'mlb' },
  'nationals': { nombre: 'Washington Nationals', deporte: 'mlb' },
  'washington': { nombre: 'Washington Nationals', deporte: 'mlb' },
  'gigantes': { nombre: 'San Francisco Giants', deporte: 'mlb' },
  'giants': { nombre: 'San Francisco Giants', deporte: 'mlb' },
  'san francisco': { nombre: 'San Francisco Giants', deporte: 'mlb' },
  'cleveland': { nombre: 'Cleveland Guardians', deporte: 'mlb' },
  'guardians': { nombre: 'Cleveland Guardians', deporte: 'mlb' },
  'tigers': { nombre: 'Detroit Tigers', deporte: 'mlb' },
  'detroit': { nombre: 'Detroit Tigers', deporte: 'mlb' },
  'rockies': { nombre: 'Colorado Rockies', deporte: 'mlb' },
  'colorado': { nombre: 'Colorado Rockies', deporte: 'mlb' },
  'braves': { nombre: 'Atlanta Braves', deporte: 'mlb' },
  'atlanta': { nombre: 'Atlanta Braves', deporte: 'mlb' },
  'white sox': { nombre: 'Chicago White Sox', deporte: 'mlb' },
  'cardinals': { nombre: 'St. Louis Cardinals', deporte: 'mlb' },
  'st luis': { nombre: 'St. Louis Cardinals', deporte: 'mlb' },
  'san luis': { nombre: 'St. Louis Cardinals', deporte: 'mlb' },
  'st. louis': { nombre: 'St. Louis Cardinals', deporte: 'mlb' },
  'angelinos': { nombre: 'Los Angeles Angels', deporte: 'mlb' },
  'anaheim': { nombre: 'Los Angeles Angels', deporte: 'mlb' },
  'seattle': { nombre: 'Seattle Mariners', deporte: 'mlb' },
  'mariners': { nombre: 'Seattle Mariners', deporte: 'mlb' },
  // Desde 2025 el equipo se mudó de Oakland a Sacramento; la API de MLB ya
  // devuelve solo "Athletics", sin ciudad. Se dejan ambos apodos.
  'oakland': { nombre: 'Athletics', deporte: 'mlb' },
  'athletics': { nombre: 'Athletics', deporte: 'mlb' },
  'san diego': { nombre: 'San Diego Padres', deporte: 'mlb' },
  'padres': { nombre: 'San Diego Padres', deporte: 'mlb' },
  'arizona': { nombre: 'Arizona Diamondbacks', deporte: 'mlb' },
  'diamondbacks': { nombre: 'Arizona Diamondbacks', deporte: 'mlb' },
  'dbacks': { nombre: 'Arizona Diamondbacks', deporte: 'mlb' },
  'blue jays': { nombre: 'Toronto Blue Jays', deporte: 'mlb' },
  'toronto': { nombre: 'Toronto Blue Jays', deporte: 'mlb' },
  'mets': { nombre: 'New York Mets', deporte: 'mlb' },
  'texas': { nombre: 'Texas Rangers', deporte: 'mlb' },
  'rangers': { nombre: 'Texas Rangers', deporte: 'mlb' },
  'cubs': { nombre: 'Chicago Cubs', deporte: 'mlb' },
  'pittsburgh': { nombre: 'Pittsburgh Pirates', deporte: 'mlb' },
  'pirates': { nombre: 'Pittsburgh Pirates', deporte: 'mlb' },
  'piratas': { nombre: 'Pittsburgh Pirates', deporte: 'mlb' },
  'miami': { nombre: 'Miami Marlins', deporte: 'mlb' },
  'marlins': { nombre: 'Miami Marlins', deporte: 'mlb' },
  'milwaukee': { nombre: 'Milwaukee Brewers', deporte: 'mlb' },
  'brewers': { nombre: 'Milwaukee Brewers', deporte: 'mlb' },
  'cincinnati': { nombre: 'Cincinnati Reds', deporte: 'mlb' },
  'cincinatti': { nombre: 'Cincinnati Reds', deporte: 'mlb' },
  'reds': { nombre: 'Cincinnati Reds', deporte: 'mlb' },
  'rojos': { nombre: 'Cincinnati Reds', deporte: 'mlb' },
  'kansas city': { nombre: 'Kansas City Royals', deporte: 'mlb' },
  'royals': { nombre: 'Kansas City Royals', deporte: 'mlb' }
};

// Diccionario BASE de los 32 equipos de la NFL (agregado 28-08-2026, junto
// con la conexión a la API de ESPN en src/services/nflApi.js — ver
// evaluador.js para cómo se decide, jugada por jugada, si evaluar contra
// MLB o contra NFL).
//
// OJO con las ciudades/apodos que se REPITEN entre MLB y NFL (ej. Houston
// tiene Astros Y Texans, Miami tiene Marlins Y Dolphins). Para los casos
// donde hasta la MASCOTA choca (Cardinals/Cardenales, Giants/Gigantes, y
// Buccaneers que en español también se dice "Piratas" — ya tomado por
// Pittsburgh Pirates de MLB) se usó un apodo distinto que no deja dudas
// (ej. "cardenales de arizona", "bucs").
//
// CORREGIDO (28-08-2026, bug reportado por el usuario con "HOUSTON NFL"):
// para las ciudades donde SÍ hay un equipo de MLB y uno de NFL a la vez
// (Houston, Miami, Filadelfia, Tampa, Minnesota, Baltimore, Washington,
// San Francisco, Cleveland, Detroit, Atlanta, Seattle, Arizona,
// Pittsburgh, Cincinnati, Kansas City), el nombre PELADO de la ciudad
// (ej. "houston", sin "texans" ni "astros") ahora se agrega TAMBIÉN acá,
// del lado NFL, en vez de evitarlo. Antes se evitaba a propósito para que
// el apodo corto "significara siempre MLB" — pero eso hacía que el
// diccionario tuviera un solo candidato para "houston" y por lo tanto
// NUNCA se activara la capa de desambiguación (resolverCandidatoAmbiguo en
// evaluador.js): aunque el trabajador escribiera "HOUSTON NFL" bien claro,
// el sistema ni se molestaba en mirar la palabra "NFL" porque ya había
// resuelto el apodo a Houston Astros de una. Con el apodo pelado agregado
// en LOS DOS deportes, "houston" pasa a tener 2 candidatos, y ahí sí entra
// a jugar TODA la cadena de capas ya construida (marcador por-jugada como
// "NFL" o 🏈 primero, después calendario, después tamaño del número,
// después marcador de sección) — si no se puede resolver con confianza,
// ahí sí queda AMBIGUA pidiendo aclaración, en vez de adivinar en
// silencio. No cambia nada para las sábanas de siempre: si solo uno de
// los 2 equipos tiene partido ese día, se resuelve solo por calendario
// igual que antes.
const DICCIONARIO_EQUIPOS_NFL_BASE = {
  'cardenales de arizona': { nombre: 'Arizona Cardinals', deporte: 'nfl' },
  'arizona cardinals': { nombre: 'Arizona Cardinals', deporte: 'nfl' },
  'cardinals nfl': { nombre: 'Arizona Cardinals', deporte: 'nfl' },
  'arizona': { nombre: 'Arizona Cardinals', deporte: 'nfl' },

  'falcons': { nombre: 'Atlanta Falcons', deporte: 'nfl' },
  'halcones': { nombre: 'Atlanta Falcons', deporte: 'nfl' },
  'atlanta falcons': { nombre: 'Atlanta Falcons', deporte: 'nfl' },
  'atlanta': { nombre: 'Atlanta Falcons', deporte: 'nfl' },

  'ravens': { nombre: 'Baltimore Ravens', deporte: 'nfl' },
  'cuervos': { nombre: 'Baltimore Ravens', deporte: 'nfl' },
  'baltimore ravens': { nombre: 'Baltimore Ravens', deporte: 'nfl' },
  'baltimore': { nombre: 'Baltimore Ravens', deporte: 'nfl' },

  'buffalo': { nombre: 'Buffalo Bills', deporte: 'nfl' },
  'bills': { nombre: 'Buffalo Bills', deporte: 'nfl' },

  'carolina': { nombre: 'Carolina Panthers', deporte: 'nfl' },
  'panthers': { nombre: 'Carolina Panthers', deporte: 'nfl' },
  'panteras': { nombre: 'Carolina Panthers', deporte: 'nfl' },

  'chicago': { nombre: 'Chicago Bears', deporte: 'nfl' },
  'bears': { nombre: 'Chicago Bears', deporte: 'nfl' },
  'osos': { nombre: 'Chicago Bears', deporte: 'nfl' },

  'bengals': { nombre: 'Cincinnati Bengals', deporte: 'nfl' },
  'cincinnati bengals': { nombre: 'Cincinnati Bengals', deporte: 'nfl' },
  'cincinnati': { nombre: 'Cincinnati Bengals', deporte: 'nfl' },
  'cincinatti': { nombre: 'Cincinnati Bengals', deporte: 'nfl' },

  'browns': { nombre: 'Cleveland Browns', deporte: 'nfl' },
  'cleveland browns': { nombre: 'Cleveland Browns', deporte: 'nfl' },
  'cleveland': { nombre: 'Cleveland Browns', deporte: 'nfl' },

  'cowboys': { nombre: 'Dallas Cowboys', deporte: 'nfl' },
  'vaqueros': { nombre: 'Dallas Cowboys', deporte: 'nfl' },
  'dallas': { nombre: 'Dallas Cowboys', deporte: 'nfl' },

  'broncos': { nombre: 'Denver Broncos', deporte: 'nfl' },
  'denver': { nombre: 'Denver Broncos', deporte: 'nfl' },

  'lions': { nombre: 'Detroit Lions', deporte: 'nfl' },
  'leones': { nombre: 'Detroit Lions', deporte: 'nfl' },
  'detroit lions': { nombre: 'Detroit Lions', deporte: 'nfl' },
  'detroit': { nombre: 'Detroit Lions', deporte: 'nfl' },

  'packers': { nombre: 'Green Bay Packers', deporte: 'nfl' },
  'empacadores': { nombre: 'Green Bay Packers', deporte: 'nfl' },
  'green bay': { nombre: 'Green Bay Packers', deporte: 'nfl' },

  'texans': { nombre: 'Houston Texans', deporte: 'nfl' },
  'texanos': { nombre: 'Houston Texans', deporte: 'nfl' },
  'houston texans': { nombre: 'Houston Texans', deporte: 'nfl' },
  'houston': { nombre: 'Houston Texans', deporte: 'nfl' },

  'indianapolis': { nombre: 'Indianapolis Colts', deporte: 'nfl' },
  'colts': { nombre: 'Indianapolis Colts', deporte: 'nfl' },
  'potros': { nombre: 'Indianapolis Colts', deporte: 'nfl' },

  'jacksonville': { nombre: 'Jacksonville Jaguars', deporte: 'nfl' },
  'jaguars': { nombre: 'Jacksonville Jaguars', deporte: 'nfl' },
  'jaguares': { nombre: 'Jacksonville Jaguars', deporte: 'nfl' },

  'chiefs': { nombre: 'Kansas City Chiefs', deporte: 'nfl' },
  'jefes': { nombre: 'Kansas City Chiefs', deporte: 'nfl' },
  'kansas city chiefs': { nombre: 'Kansas City Chiefs', deporte: 'nfl' },
  'kansas city': { nombre: 'Kansas City Chiefs', deporte: 'nfl' },

  'las vegas': { nombre: 'Las Vegas Raiders', deporte: 'nfl' },
  'raiders': { nombre: 'Las Vegas Raiders', deporte: 'nfl' },

  'chargers': { nombre: 'Los Angeles Chargers', deporte: 'nfl' },
  'rayos': { nombre: 'Los Angeles Chargers', deporte: 'nfl' },
  'la chargers': { nombre: 'Los Angeles Chargers', deporte: 'nfl' },

  'rams': { nombre: 'Los Angeles Rams', deporte: 'nfl' },
  'carneros': { nombre: 'Los Angeles Rams', deporte: 'nfl' },
  'la rams': { nombre: 'Los Angeles Rams', deporte: 'nfl' },

  'dolphins': { nombre: 'Miami Dolphins', deporte: 'nfl' },
  'delfines': { nombre: 'Miami Dolphins', deporte: 'nfl' },
  'miami dolphins': { nombre: 'Miami Dolphins', deporte: 'nfl' },
  'miami': { nombre: 'Miami Dolphins', deporte: 'nfl' },

  'vikings': { nombre: 'Minnesota Vikings', deporte: 'nfl' },
  'vikingos': { nombre: 'Minnesota Vikings', deporte: 'nfl' },
  'minnesota vikings': { nombre: 'Minnesota Vikings', deporte: 'nfl' },
  'minnesota': { nombre: 'Minnesota Vikings', deporte: 'nfl' },
  'minesota': { nombre: 'Minnesota Vikings', deporte: 'nfl' },

  'patriots': { nombre: 'New England Patriots', deporte: 'nfl' },
  'patriotas': { nombre: 'New England Patriots', deporte: 'nfl' },
  'new england': { nombre: 'New England Patriots', deporte: 'nfl' },

  'new orleans': { nombre: 'New Orleans Saints', deporte: 'nfl' },
  'saints': { nombre: 'New Orleans Saints', deporte: 'nfl' },
  'santos': { nombre: 'New Orleans Saints', deporte: 'nfl' },

  'ny giants': { nombre: 'New York Giants', deporte: 'nfl' },
  'new york giants': { nombre: 'New York Giants', deporte: 'nfl' },
  'gigantes de ny': { nombre: 'New York Giants', deporte: 'nfl' },
  'giants nfl': { nombre: 'New York Giants', deporte: 'nfl' },

  'jets': { nombre: 'New York Jets', deporte: 'nfl' },
  'ny jets': { nombre: 'New York Jets', deporte: 'nfl' },

  'eagles': { nombre: 'Philadelphia Eagles', deporte: 'nfl' },
  'aguilas': { nombre: 'Philadelphia Eagles', deporte: 'nfl' },
  'philadelphia eagles': { nombre: 'Philadelphia Eagles', deporte: 'nfl' },
  'philadelphia': { nombre: 'Philadelphia Eagles', deporte: 'nfl' },
  'filadelfia': { nombre: 'Philadelphia Eagles', deporte: 'nfl' },

  'steelers': { nombre: 'Pittsburgh Steelers', deporte: 'nfl' },
  'acereros': { nombre: 'Pittsburgh Steelers', deporte: 'nfl' },
  'pittsburgh steelers': { nombre: 'Pittsburgh Steelers', deporte: 'nfl' },
  'pittsburgh': { nombre: 'Pittsburgh Steelers', deporte: 'nfl' },

  '49ers': { nombre: 'San Francisco 49ers', deporte: 'nfl' },
  'niners': { nombre: 'San Francisco 49ers', deporte: 'nfl' },
  'san francisco 49ers': { nombre: 'San Francisco 49ers', deporte: 'nfl' },
  'san francisco': { nombre: 'San Francisco 49ers', deporte: 'nfl' },

  'seahawks': { nombre: 'Seattle Seahawks', deporte: 'nfl' },
  'seattle seahawks': { nombre: 'Seattle Seahawks', deporte: 'nfl' },
  'seattle': { nombre: 'Seattle Seahawks', deporte: 'nfl' },

  'buccaneers': { nombre: 'Tampa Bay Buccaneers', deporte: 'nfl' },
  'bucs': { nombre: 'Tampa Bay Buccaneers', deporte: 'nfl' },
  'tampa bay buccaneers': { nombre: 'Tampa Bay Buccaneers', deporte: 'nfl' },
  'tampa': { nombre: 'Tampa Bay Buccaneers', deporte: 'nfl' },

  'tennessee': { nombre: 'Tennessee Titans', deporte: 'nfl' },
  'titans': { nombre: 'Tennessee Titans', deporte: 'nfl' },
  'titanes': { nombre: 'Tennessee Titans', deporte: 'nfl' },

  'commanders': { nombre: 'Washington Commanders', deporte: 'nfl' },
  'comandantes': { nombre: 'Washington Commanders', deporte: 'nfl' },
  'washington commanders': { nombre: 'Washington Commanders', deporte: 'nfl' },
  'washington': { nombre: 'Washington Commanders', deporte: 'nfl' }
};

// =================================================================
// NHL (32 equipos) — agregado 28-08-2026 en la MISMA entrega que su
// conector (src/services/nhlApi.js), siguiendo la práctica establecida.
// Para la enorme mayoría de las 32 ciudades se usó a propósito SOLO el
// nombre completo/la mascota (ej. "penguins"/"pittsburgh penguins", no
// "pittsburgh" pelado) para no chocar sin necesidad con el apodo pelado
// de MLB/NFL de esa misma ciudad (Filadelfia, Washington, Pittsburgh,
// etc. ya tienen su ciudad pelada resuelta a MLB/NFL — no hace falta
// tocar eso). En un puñado de ciudades SIN colisión posible (Toronto,
// Buffalo, Dallas, Chicago, Anaheim) sí se dejó también el nombre pelado
// de la ciudad; ahí, si esa misma palabra ya apunta a un equipo de otro
// deporte (ej. "dallas" ya era Dallas Cowboys/nfl), el apodo pasa a tener
// 2 candidatos automáticamente (mismo mecanismo que Houston/Miami entre
// MLB y NFL) y lo resuelve la desambiguación de 5 capas de siempre — no
// hace falta nada especial acá.
const DICCIONARIO_EQUIPOS_NHL_BASE = {
  'bruins': { nombre: 'Boston Bruins', deporte: 'nhl' },
  'boston bruins': { nombre: 'Boston Bruins', deporte: 'nhl' },

  'sabres': { nombre: 'Buffalo Sabres', deporte: 'nhl' },
  'buffalo': { nombre: 'Buffalo Sabres', deporte: 'nhl' },

  'red wings': { nombre: 'Detroit Red Wings', deporte: 'nhl' },
  'alas rojas': { nombre: 'Detroit Red Wings', deporte: 'nhl' },

  // 'panthers' a secas se agrega acá (31-08-2026) además de 'panthers nhl':
  // hasta ahora "panthers" solo existía en DICCIONARIO_EQUIPOS_NFL_BASE
  // (Carolina Panthers), así que un ticket real que dijera solo "Panthers"
  // para Florida Panthers/NHL nunca hubiera podido resolverse a NHL —
  // ahora queda como candidato doble (Carolina Panthers/NFL y Florida
  // Panthers/NHL) y lo resuelve la desambiguación de 5 capas de siempre
  // (evaluador.js), igual que ya pasa con Houston o Miami.
  'panthers': { nombre: 'Florida Panthers', deporte: 'nhl' },
  'panthers nhl': { nombre: 'Florida Panthers', deporte: 'nhl' },
  'florida': { nombre: 'Florida Panthers', deporte: 'nhl' },
  'florida panthers': { nombre: 'Florida Panthers', deporte: 'nhl' },

  'canadiens': { nombre: 'Montreal Canadiens', deporte: 'nhl' },
  'montreal': { nombre: 'Montreal Canadiens', deporte: 'nhl' },
  'montreal canadiens': { nombre: 'Montreal Canadiens', deporte: 'nhl' },

  'senators': { nombre: 'Ottawa Senators', deporte: 'nhl' },
  'ottawa': { nombre: 'Ottawa Senators', deporte: 'nhl' },
  'senadores': { nombre: 'Ottawa Senators', deporte: 'nhl' },

  'lightning': { nombre: 'Tampa Bay Lightning', deporte: 'nhl' },
  'tampa bay lightning': { nombre: 'Tampa Bay Lightning', deporte: 'nhl' },

  'maple leafs': { nombre: 'Toronto Maple Leafs', deporte: 'nhl' },
  'leafs': { nombre: 'Toronto Maple Leafs', deporte: 'nhl' },
  'toronto': { nombre: 'Toronto Maple Leafs', deporte: 'nhl' },

  'hurricanes': { nombre: 'Carolina Hurricanes', deporte: 'nhl' },
  'carolina': { nombre: 'Carolina Hurricanes', deporte: 'nhl' },
  'canes': { nombre: 'Carolina Hurricanes', deporte: 'nhl' },

  'blue jackets': { nombre: 'Columbus Blue Jackets', deporte: 'nhl' },
  'columbus': { nombre: 'Columbus Blue Jackets', deporte: 'nhl' },

  'devils': { nombre: 'New Jersey Devils', deporte: 'nhl' },
  'new jersey': { nombre: 'New Jersey Devils', deporte: 'nhl' },
  'diablos nhl': { nombre: 'New Jersey Devils', deporte: 'nhl' },

  'islanders': { nombre: 'New York Islanders', deporte: 'nhl' },
  'ny islanders': { nombre: 'New York Islanders', deporte: 'nhl' },

  'rangers': { nombre: 'New York Rangers', deporte: 'nhl' },
  'ny rangers': { nombre: 'New York Rangers', deporte: 'nhl' },

  'flyers': { nombre: 'Philadelphia Flyers', deporte: 'nhl' },
  'philadelphia flyers': { nombre: 'Philadelphia Flyers', deporte: 'nhl' },

  'penguins': { nombre: 'Pittsburgh Penguins', deporte: 'nhl' },
  'pinguinos': { nombre: 'Pittsburgh Penguins', deporte: 'nhl' },
  'pittsburgh penguins': { nombre: 'Pittsburgh Penguins', deporte: 'nhl' },

  'capitals': { nombre: 'Washington Capitals', deporte: 'nhl' },
  'washington capitals': { nombre: 'Washington Capitals', deporte: 'nhl' },

  'blackhawks': { nombre: 'Chicago Blackhawks', deporte: 'nhl' },
  'chicago blackhawks': { nombre: 'Chicago Blackhawks', deporte: 'nhl' },
  'chicago': { nombre: 'Chicago Blackhawks', deporte: 'nhl' },

  'avalanche': { nombre: 'Colorado Avalanche', deporte: 'nhl' },
  'colorado': { nombre: 'Colorado Avalanche', deporte: 'nhl' },
  'avalancha': { nombre: 'Colorado Avalanche', deporte: 'nhl' },

  'stars': { nombre: 'Dallas Stars', deporte: 'nhl' },
  'dallas': { nombre: 'Dallas Stars', deporte: 'nhl' },
  'estrellas': { nombre: 'Dallas Stars', deporte: 'nhl' },

  'wild': { nombre: 'Minnesota Wild', deporte: 'nhl' },
  'minnesota wild': { nombre: 'Minnesota Wild', deporte: 'nhl' },

  'predators': { nombre: 'Nashville Predators', deporte: 'nhl' },
  'nashville': { nombre: 'Nashville Predators', deporte: 'nhl' },
  'depredadores': { nombre: 'Nashville Predators', deporte: 'nhl' },

  'blues': { nombre: 'St. Louis Blues', deporte: 'nhl' },
  'st louis blues': { nombre: 'St. Louis Blues', deporte: 'nhl' },
  'st. louis blues': { nombre: 'St. Louis Blues', deporte: 'nhl' },

  'jets nhl': { nombre: 'Winnipeg Jets', deporte: 'nhl' },
  'winnipeg': { nombre: 'Winnipeg Jets', deporte: 'nhl' },

  'utah mammoth': { nombre: 'Utah Mammoth', deporte: 'nhl' },
  'utah': { nombre: 'Utah Mammoth', deporte: 'nhl' },
  'mammoth': { nombre: 'Utah Mammoth', deporte: 'nhl' },

  'ducks': { nombre: 'Anaheim Ducks', deporte: 'nhl' },
  'anaheim': { nombre: 'Anaheim Ducks', deporte: 'nhl' },
  'patos': { nombre: 'Anaheim Ducks', deporte: 'nhl' },

  'flames': { nombre: 'Calgary Flames', deporte: 'nhl' },
  'calgary': { nombre: 'Calgary Flames', deporte: 'nhl' },
  'llamas': { nombre: 'Calgary Flames', deporte: 'nhl' },

  'oilers': { nombre: 'Edmonton Oilers', deporte: 'nhl' },
  'edmonton': { nombre: 'Edmonton Oilers', deporte: 'nhl' },

  'kings': { nombre: 'Los Angeles Kings', deporte: 'nhl' },
  'la kings': { nombre: 'Los Angeles Kings', deporte: 'nhl' },
  'reyes': { nombre: 'Los Angeles Kings', deporte: 'nhl' },

  'sharks': { nombre: 'San Jose Sharks', deporte: 'nhl' },
  'san jose': { nombre: 'San Jose Sharks', deporte: 'nhl' },
  'tiburones': { nombre: 'San Jose Sharks', deporte: 'nhl' },

  'kraken': { nombre: 'Seattle Kraken', deporte: 'nhl' },
  'seattle kraken': { nombre: 'Seattle Kraken', deporte: 'nhl' },

  'canucks': { nombre: 'Vancouver Canucks', deporte: 'nhl' },
  'vancouver': { nombre: 'Vancouver Canucks', deporte: 'nhl' },

  'golden knights': { nombre: 'Vegas Golden Knights', deporte: 'nhl' },
  'vegas': { nombre: 'Vegas Golden Knights', deporte: 'nhl' },
  'las vegas nhl': { nombre: 'Vegas Golden Knights', deporte: 'nhl' }
};

// =================================================================
// FÚTBOL / SOCCER — agregado 28-08-2026, mismo día que su conector
// (src/services/soccerApi.js), a pedido explícito del usuario, que
// eligió estas 10 competiciones: Premier League, La Liga, Serie A,
// Bundesliga, Ligue 1, Liga MX, MLS, Champions League, Copa Libertadores
// y Copa Sudamericana. Ampliado el 31-08-2026 con UEFA Europa League y
// UEFA Conference League (12 competiciones en total) — ver LIGAS_SOCCER
// en soccerApi.js.
//
// OJO — esto es una SEMILLA, no un roster exhaustivo: a diferencia de
// MLB/NFL/NHL (ligas cerradas de 30-32 equipos fijos), estas 10
// competiciones suman varios cientos de clubes en total, y varios cambian
// de categoría cada temporada (ascenso/descenso). Se cargaron acá los
// clubes más conocidos/más probables de aparecer en una sábana real de
// cada competición — igual que pasó con MLB/NFL al principio, este
// diccionario va a crecer con ejemplos reales que mande el usuario (ver
// "Pendiente: revisión continua de formatos reales" en el doc de
// proyecto) — no hace falta ni se intentó cubrir cada club de cada liga
// de una sola vez.
//
// Todos los clubes de acá comparten el mismo código de deporte "soccer"
// (evaluador.js no distingue Premier League de Champions League — un
// jugador puede jugar los 2 torneos el mismo mes). Cuando el nombre
// PELADO de una ciudad ya existe en MLB/NFL/NHL (ej. "miami" ya es Miami
// Marlins/mlb y Miami Dolphins/nfl), agregar ese mismo apodo acá lo
// convierte automáticamente en un candidato MÁS dentro del array — la
// desambiguación de 5 capas ya construida (ver evaluador.js) decide solo
// cuál corresponde, exactamente igual que ya hace hoy con Houston/Miami
// entre MLB y NFL (esto ya se probó con un caso de prueba real de 3
// deportes a la vez — MLB/NFL/soccer — en la ronda de "Múltiples
// deportes").
const DICCIONARIO_EQUIPOS_SOCCER_BASE = {
  // --- Premier League (Inglaterra) ---
  'manchester united': { nombre: 'Manchester United', deporte: 'soccer' },
  'man united': { nombre: 'Manchester United', deporte: 'soccer' },
  'man utd': { nombre: 'Manchester United', deporte: 'soccer' },
  'manchester city': { nombre: 'Manchester City', deporte: 'soccer' },
  'man city': { nombre: 'Manchester City', deporte: 'soccer' },
  'liverpool': { nombre: 'Liverpool', deporte: 'soccer' },
  'chelsea': { nombre: 'Chelsea', deporte: 'soccer' },
  'arsenal': { nombre: 'Arsenal', deporte: 'soccer' },
  'tottenham': { nombre: 'Tottenham Hotspur', deporte: 'soccer' },
  'spurs': { nombre: 'Tottenham Hotspur', deporte: 'soccer' },
  'newcastle': { nombre: 'Newcastle United', deporte: 'soccer' },
  'aston villa': { nombre: 'Aston Villa', deporte: 'soccer' },
  'west ham': { nombre: 'West Ham United', deporte: 'soccer' },
  'everton': { nombre: 'Everton', deporte: 'soccer' },
  'brighton': { nombre: 'Brighton & Hove Albion', deporte: 'soccer' },
  'wolves': { nombre: 'Wolverhampton Wanderers', deporte: 'soccer' },
  'crystal palace': { nombre: 'Crystal Palace', deporte: 'soccer' },
  'fulham': { nombre: 'Fulham', deporte: 'soccer' },
  'brentford': { nombre: 'Brentford', deporte: 'soccer' },
  'bournemouth': { nombre: 'AFC Bournemouth', deporte: 'soccer' },
  'nottingham forest': { nombre: 'Nottingham Forest', deporte: 'soccer' },
  'leeds united': { nombre: 'Leeds United', deporte: 'soccer' },
  'leeds': { nombre: 'Leeds United', deporte: 'soccer' },

  // --- La Liga (España) ---
  'real madrid': { nombre: 'Real Madrid', deporte: 'soccer' },
  'barcelona': { nombre: 'Barcelona', deporte: 'soccer' },
  'barca': { nombre: 'Barcelona', deporte: 'soccer' },
  'atletico madrid': { nombre: 'Atlético Madrid', deporte: 'soccer' },
  'atletico de madrid': { nombre: 'Atlético Madrid', deporte: 'soccer' },
  'sevilla': { nombre: 'Sevilla', deporte: 'soccer' },
  'real betis': { nombre: 'Real Betis', deporte: 'soccer' },
  'betis': { nombre: 'Real Betis', deporte: 'soccer' },
  'real sociedad': { nombre: 'Real Sociedad', deporte: 'soccer' },
  'villarreal': { nombre: 'Villarreal', deporte: 'soccer' },
  'athletic bilbao': { nombre: 'Athletic Club', deporte: 'soccer' },
  'athletic club': { nombre: 'Athletic Club', deporte: 'soccer' },
  'valencia': { nombre: 'Valencia', deporte: 'soccer' },
  'celta de vigo': { nombre: 'Celta Vigo', deporte: 'soccer' },
  'celta vigo': { nombre: 'Celta Vigo', deporte: 'soccer' },
  'getafe': { nombre: 'Getafe', deporte: 'soccer' },
  'osasuna': { nombre: 'Osasuna', deporte: 'soccer' },
  'girona': { nombre: 'Girona', deporte: 'soccer' },
  'rayo vallecano': { nombre: 'Rayo Vallecano', deporte: 'soccer' },
  'mallorca': { nombre: 'Mallorca', deporte: 'soccer' },
  'espanyol': { nombre: 'Espanyol', deporte: 'soccer' },
  'alaves': { nombre: 'Alavés', deporte: 'soccer' },

  // --- Serie A (Italia) ---
  'juventus': { nombre: 'Juventus', deporte: 'soccer' },
  'ac milan': { nombre: 'AC Milan', deporte: 'soccer' },
  'milan': { nombre: 'AC Milan', deporte: 'soccer' },
  'inter de milan': { nombre: 'Inter Milan', deporte: 'soccer' },
  'inter milan': { nombre: 'Inter Milan', deporte: 'soccer' },
  'napoli': { nombre: 'Napoli', deporte: 'soccer' },
  'roma': { nombre: 'AS Roma', deporte: 'soccer' },
  'as roma': { nombre: 'AS Roma', deporte: 'soccer' },
  'lazio': { nombre: 'Lazio', deporte: 'soccer' },
  'atalanta': { nombre: 'Atalanta', deporte: 'soccer' },
  'fiorentina': { nombre: 'Fiorentina', deporte: 'soccer' },
  'torino': { nombre: 'Torino', deporte: 'soccer' },
  'bologna': { nombre: 'Bologna', deporte: 'soccer' },
  'udinese': { nombre: 'Udinese', deporte: 'soccer' },
  'genoa': { nombre: 'Genoa', deporte: 'soccer' },
  'como': { nombre: 'Como', deporte: 'soccer' },
  'parma': { nombre: 'Parma', deporte: 'soccer' },
  'cagliari': { nombre: 'Cagliari', deporte: 'soccer' },
  'monza': { nombre: 'Monza', deporte: 'soccer' },

  // --- Bundesliga (Alemania) ---
  'bayern munich': { nombre: 'Bayern Munich', deporte: 'soccer' },
  'bayern': { nombre: 'Bayern Munich', deporte: 'soccer' },
  'borussia dortmund': { nombre: 'Borussia Dortmund', deporte: 'soccer' },
  'dortmund': { nombre: 'Borussia Dortmund', deporte: 'soccer' },
  'bvb': { nombre: 'Borussia Dortmund', deporte: 'soccer' },
  'rb leipzig': { nombre: 'RB Leipzig', deporte: 'soccer' },
  'leipzig': { nombre: 'RB Leipzig', deporte: 'soccer' },
  'bayer leverkusen': { nombre: 'Bayer Leverkusen', deporte: 'soccer' },
  'leverkusen': { nombre: 'Bayer Leverkusen', deporte: 'soccer' },
  'eintracht frankfurt': { nombre: 'Eintracht Frankfurt', deporte: 'soccer' },
  'frankfurt': { nombre: 'Eintracht Frankfurt', deporte: 'soccer' },
  'borussia monchengladbach': { nombre: 'Borussia Mönchengladbach', deporte: 'soccer' },
  'monchengladbach': { nombre: 'Borussia Mönchengladbach', deporte: 'soccer' },
  'wolfsburg': { nombre: 'Wolfsburg', deporte: 'soccer' },
  'stuttgart': { nombre: 'VfB Stuttgart', deporte: 'soccer' },
  'union berlin': { nombre: 'Union Berlin', deporte: 'soccer' },
  'hoffenheim': { nombre: 'Hoffenheim', deporte: 'soccer' },
  'freiburg': { nombre: 'SC Freiburg', deporte: 'soccer' },
  'mainz': { nombre: 'Mainz 05', deporte: 'soccer' },

  // --- Ligue 1 (Francia) ---
  'paris saint germain': { nombre: 'Paris Saint-Germain', deporte: 'soccer' },
  'psg': { nombre: 'Paris Saint-Germain', deporte: 'soccer' },
  'marsella': { nombre: 'Olympique Marseille', deporte: 'soccer' },
  'marseille': { nombre: 'Olympique Marseille', deporte: 'soccer' },
  'lyon': { nombre: 'Olympique Lyonnais', deporte: 'soccer' },
  'mónaco': { nombre: 'Monaco', deporte: 'soccer' },
  'monaco': { nombre: 'Monaco', deporte: 'soccer' },
  'lille': { nombre: 'Lille', deporte: 'soccer' },
  'niza': { nombre: 'Nice', deporte: 'soccer' },
  'nice': { nombre: 'Nice', deporte: 'soccer' },
  'rennes': { nombre: 'Rennes', deporte: 'soccer' },
  'lens': { nombre: 'Lens', deporte: 'soccer' },
  'estrasburgo': { nombre: 'Strasbourg', deporte: 'soccer' },
  'strasbourg': { nombre: 'Strasbourg', deporte: 'soccer' },
  'toulouse': { nombre: 'Toulouse', deporte: 'soccer' },

  // --- Liga MX (México) ---
  'america': { nombre: 'Club América', deporte: 'soccer' },
  'club america': { nombre: 'Club América', deporte: 'soccer' },
  'chivas': { nombre: 'Chivas Guadalajara', deporte: 'soccer' },
  'guadalajara': { nombre: 'Chivas Guadalajara', deporte: 'soccer' },
  'cruz azul': { nombre: 'Cruz Azul', deporte: 'soccer' },
  'pumas': { nombre: 'Pumas UNAM', deporte: 'soccer' },
  'pumas unam': { nombre: 'Pumas UNAM', deporte: 'soccer' },
  'monterrey': { nombre: 'CF Monterrey', deporte: 'soccer' },
  'rayados': { nombre: 'CF Monterrey', deporte: 'soccer' },
  'tigres': { nombre: 'Tigres UANL', deporte: 'soccer' },
  'tigres uanl': { nombre: 'Tigres UANL', deporte: 'soccer' },
  'toluca': { nombre: 'Toluca', deporte: 'soccer' },
  'leon': { nombre: 'León', deporte: 'soccer' },
  'santos laguna': { nombre: 'Santos Laguna', deporte: 'soccer' },
  'pachuca': { nombre: 'Pachuca', deporte: 'soccer' },
  'necaxa': { nombre: 'Necaxa', deporte: 'soccer' },
  'atlas': { nombre: 'Atlas', deporte: 'soccer' },
  'puebla': { nombre: 'Puebla', deporte: 'soccer' },
  'tijuana': { nombre: 'Club Tijuana', deporte: 'soccer' },
  'xolos': { nombre: 'Club Tijuana', deporte: 'soccer' },
  'atletico san luis': { nombre: 'Atlético San Luis', deporte: 'soccer' },
  'mazatlan': { nombre: 'Mazatlán FC', deporte: 'soccer' },
  'queretaro': { nombre: 'Querétaro', deporte: 'soccer' },
  'juarez': { nombre: 'FC Juárez', deporte: 'soccer' },
  'atlante': { nombre: 'Atlante', deporte: 'soccer' },

  // --- MLS (Estados Unidos/Canadá) ---
  'inter miami': { nombre: 'Inter Miami CF', deporte: 'soccer' },
  'inter miami cf': { nombre: 'Inter Miami CF', deporte: 'soccer' },
  'la galaxy': { nombre: 'LA Galaxy', deporte: 'soccer' },
  'lafc': { nombre: 'Los Angeles FC', deporte: 'soccer' },
  'seattle sounders': { nombre: 'Seattle Sounders FC', deporte: 'soccer' },
  'atlanta united': { nombre: 'Atlanta United FC', deporte: 'soccer' },
  'new york city fc': { nombre: 'New York City FC', deporte: 'soccer' },
  'nycfc': { nombre: 'New York City FC', deporte: 'soccer' },
  'new york red bulls': { nombre: 'New York Red Bulls', deporte: 'soccer' },
  'red bulls': { nombre: 'New York Red Bulls', deporte: 'soccer' },
  'columbus crew': { nombre: 'Columbus Crew', deporte: 'soccer' },
  'philadelphia union': { nombre: 'Philadelphia Union', deporte: 'soccer' },
  'orlando city': { nombre: 'Orlando City SC', deporte: 'soccer' },
  'fc cincinnati': { nombre: 'FC Cincinnati', deporte: 'soccer' },

  // --- Sudamérica (relevante sobre todo para Copa Libertadores/Sudamericana) ---
  'river plate': { nombre: 'River Plate', deporte: 'soccer' },
  'boca juniors': { nombre: 'Boca Juniors', deporte: 'soccer' },
  'boca': { nombre: 'Boca Juniors', deporte: 'soccer' },
  'racing club': { nombre: 'Racing Club', deporte: 'soccer' },
  'independiente': { nombre: 'Independiente', deporte: 'soccer' },
  'san lorenzo': { nombre: 'San Lorenzo', deporte: 'soccer' },
  'flamengo': { nombre: 'Flamengo', deporte: 'soccer' },
  'palmeiras': { nombre: 'Palmeiras', deporte: 'soccer' },
  'sao paulo': { nombre: 'São Paulo', deporte: 'soccer' },
  'corinthians': { nombre: 'Corinthians', deporte: 'soccer' },
  'gremio': { nombre: 'Grêmio', deporte: 'soccer' },
  'internacional': { nombre: 'Internacional', deporte: 'soccer' },
  'santos fc': { nombre: 'Santos FC', deporte: 'soccer' },
  'nacional': { nombre: 'Nacional', deporte: 'soccer' },
  'penarol': { nombre: 'Peñarol', deporte: 'soccer' },
  'colo colo': { nombre: 'Colo-Colo', deporte: 'soccer' },
  'universidad de chile': { nombre: 'Universidad de Chile', deporte: 'soccer' },
  'atletico nacional': { nombre: 'Atlético Nacional', deporte: 'soccer' },
  'millonarios': { nombre: 'Millonarios', deporte: 'soccer' },
  'independiente del valle': { nombre: 'Independiente del Valle', deporte: 'soccer' },
  'liga de quito': { nombre: 'Liga de Quito', deporte: 'soccer' },
  'cerro porteno': { nombre: 'Cerro Porteño', deporte: 'soccer' },
  'olimpia': { nombre: 'Olimpia', deporte: 'soccer' }
};

// =================================================================
// NBA — agregada 31-08-2026, mismo día que su conector
// (src/services/nbaApi.js), a pedido explícito del usuario, junto con la
// funcionalidad de apuestas "por cuarto" (ver detectarCuartoEnJugada en
// evaluador.js). Los 30 equipos de la liga, mismo criterio que MLB/NFL/NHL
// (liga cerrada de tamaño fijo, se cargan todos de una sola vez).
//
// Varios apodos de acá YA EXISTÍAN en otro deporte (ej. "kings" ya era Los
// Angeles Kings/NHL, "spurs" ya era Tottenham Hotspur/soccer, "wolves" ya
// era Wolverhampton/soccer) — no hace falta ningún cambio especial para
// esos casos: combinarBasesPorDeporte() de más abajo los convierte
// automáticamente en candidatos múltiples y la desambiguación de 5 capas
// de evaluador.js decide cuál corresponde, igual que ya pasa con
// Houston/Miami/Panthers.
const DICCIONARIO_EQUIPOS_NBA_BASE = {
  'hawks': { nombre: 'Atlanta Hawks', deporte: 'basket' },
  'atlanta hawks': { nombre: 'Atlanta Hawks', deporte: 'basket' },

  'celtics': { nombre: 'Boston Celtics', deporte: 'basket' },
  'boston celtics': { nombre: 'Boston Celtics', deporte: 'basket' },

  'nets': { nombre: 'Brooklyn Nets', deporte: 'basket' },
  'brooklyn': { nombre: 'Brooklyn Nets', deporte: 'basket' },
  'brooklyn nets': { nombre: 'Brooklyn Nets', deporte: 'basket' },

  'hornets': { nombre: 'Charlotte Hornets', deporte: 'basket' },
  'charlotte': { nombre: 'Charlotte Hornets', deporte: 'basket' },

  'bulls': { nombre: 'Chicago Bulls', deporte: 'basket' },
  'chicago bulls': { nombre: 'Chicago Bulls', deporte: 'basket' },
  'toros': { nombre: 'Chicago Bulls', deporte: 'basket' },

  'cavaliers': { nombre: 'Cleveland Cavaliers', deporte: 'basket' },
  'cavs': { nombre: 'Cleveland Cavaliers', deporte: 'basket' },
  'cleveland cavaliers': { nombre: 'Cleveland Cavaliers', deporte: 'basket' },

  'mavericks': { nombre: 'Dallas Mavericks', deporte: 'basket' },
  'mavs': { nombre: 'Dallas Mavericks', deporte: 'basket' },
  'dallas mavericks': { nombre: 'Dallas Mavericks', deporte: 'basket' },

  'nuggets': { nombre: 'Denver Nuggets', deporte: 'basket' },
  'denver': { nombre: 'Denver Nuggets', deporte: 'basket' },
  'denver nuggets': { nombre: 'Denver Nuggets', deporte: 'basket' },

  'pistons': { nombre: 'Detroit Pistons', deporte: 'basket' },
  'detroit pistons': { nombre: 'Detroit Pistons', deporte: 'basket' },

  'warriors': { nombre: 'Golden State Warriors', deporte: 'basket' },
  'golden state': { nombre: 'Golden State Warriors', deporte: 'basket' },
  'golden state warriors': { nombre: 'Golden State Warriors', deporte: 'basket' },

  'rockets': { nombre: 'Houston Rockets', deporte: 'basket' },
  'houston rockets': { nombre: 'Houston Rockets', deporte: 'basket' },

  'pacers': { nombre: 'Indiana Pacers', deporte: 'basket' },
  'indiana': { nombre: 'Indiana Pacers', deporte: 'basket' },
  'indiana pacers': { nombre: 'Indiana Pacers', deporte: 'basket' },

  'clippers': { nombre: 'LA Clippers', deporte: 'basket' },
  'la clippers': { nombre: 'LA Clippers', deporte: 'basket' },

  'lakers': { nombre: 'Los Angeles Lakers', deporte: 'basket' },
  'los angeles lakers': { nombre: 'Los Angeles Lakers', deporte: 'basket' },

  'grizzlies': { nombre: 'Memphis Grizzlies', deporte: 'basket' },
  'memphis': { nombre: 'Memphis Grizzlies', deporte: 'basket' },
  'memphis grizzlies': { nombre: 'Memphis Grizzlies', deporte: 'basket' },

  'heat': { nombre: 'Miami Heat', deporte: 'basket' },
  'miami heat': { nombre: 'Miami Heat', deporte: 'basket' },

  'bucks': { nombre: 'Milwaukee Bucks', deporte: 'basket' },
  'milwaukee': { nombre: 'Milwaukee Bucks', deporte: 'basket' },
  'milwaukee bucks': { nombre: 'Milwaukee Bucks', deporte: 'basket' },

  'timberwolves': { nombre: 'Minnesota Timberwolves', deporte: 'basket' },
  'wolves': { nombre: 'Minnesota Timberwolves', deporte: 'basket' },
  'minnesota timberwolves': { nombre: 'Minnesota Timberwolves', deporte: 'basket' },

  'pelicans': { nombre: 'New Orleans Pelicans', deporte: 'basket' },
  'new orleans': { nombre: 'New Orleans Pelicans', deporte: 'basket' },
  'new orleans pelicans': { nombre: 'New Orleans Pelicans', deporte: 'basket' },

  'knicks': { nombre: 'New York Knicks', deporte: 'basket' },
  'ny knicks': { nombre: 'New York Knicks', deporte: 'basket' },
  'new york knicks': { nombre: 'New York Knicks', deporte: 'basket' },

  'thunder': { nombre: 'Oklahoma City Thunder', deporte: 'basket' },
  'okc': { nombre: 'Oklahoma City Thunder', deporte: 'basket' },
  'oklahoma city': { nombre: 'Oklahoma City Thunder', deporte: 'basket' },
  'oklahoma city thunder': { nombre: 'Oklahoma City Thunder', deporte: 'basket' },

  'magic': { nombre: 'Orlando Magic', deporte: 'basket' },
  'orlando': { nombre: 'Orlando Magic', deporte: 'basket' },
  'orlando magic': { nombre: 'Orlando Magic', deporte: 'basket' },

  'sixers': { nombre: 'Philadelphia 76ers', deporte: 'basket' },
  '76ers': { nombre: 'Philadelphia 76ers', deporte: 'basket' },
  'philadelphia 76ers': { nombre: 'Philadelphia 76ers', deporte: 'basket' },

  'suns': { nombre: 'Phoenix Suns', deporte: 'basket' },
  'phoenix': { nombre: 'Phoenix Suns', deporte: 'basket' },
  'phoenix suns': { nombre: 'Phoenix Suns', deporte: 'basket' },

  'trail blazers': { nombre: 'Portland Trail Blazers', deporte: 'basket' },
  'blazers': { nombre: 'Portland Trail Blazers', deporte: 'basket' },
  'portland': { nombre: 'Portland Trail Blazers', deporte: 'basket' },
  'portland trail blazers': { nombre: 'Portland Trail Blazers', deporte: 'basket' },

  'kings': { nombre: 'Sacramento Kings', deporte: 'basket' },
  'sacramento': { nombre: 'Sacramento Kings', deporte: 'basket' },
  'sacramento kings': { nombre: 'Sacramento Kings', deporte: 'basket' },

  'spurs': { nombre: 'San Antonio Spurs', deporte: 'basket' },
  'san antonio': { nombre: 'San Antonio Spurs', deporte: 'basket' },
  'san antonio spurs': { nombre: 'San Antonio Spurs', deporte: 'basket' },

  'raptors': { nombre: 'Toronto Raptors', deporte: 'basket' },
  'toronto raptors': { nombre: 'Toronto Raptors', deporte: 'basket' },

  'jazz': { nombre: 'Utah Jazz', deporte: 'basket' },
  'utah jazz': { nombre: 'Utah Jazz', deporte: 'basket' },

  'wizards': { nombre: 'Washington Wizards', deporte: 'basket' },
  'washington wizards': { nombre: 'Washington Wizards', deporte: 'basket' }
};

// =================================================================
// NCAAF (fútbol americano universitario) — agregado 12-09-2026, a partir
// de un ticket real del usuario: "Over Miami Florida🏈(66)-110 / 49ers
// 🏈(+3.5)-110 / Yankees⚾️(-300)... como este ticket tiene un juego de
// ncaaf y aun no tenemos esa api me marca como pendiente pero manualmente
// ya yo marque que se cumple el parley por que no funciona?".
//
// ACTUALIZADO 12-09-2026 (mismo día, a pedido explícito del usuario: "crees
// que puedas agregar una api para ncaaf? existe?"): ahora SÍ hay una API
// conectada (ver ncaafApi.js, misma API "oculta" de ESPN que ya usa NFL, y
// CONFIG_POR_DEPORTE.ncaaf en evaluador.js) — un ticket de NCAAF puede
// resolverse SOLO de acá en más, no solo con el marcador manual. Se
// aprovechó la misma entrega para agregar el diccionario de los programas
// más conocidos/apostados (las 4 conferencias "Power" + Notre Dame, ~68
// equipos), no solo el de Miami del ticket original.
//
// LA CAUSA de que "Miami Florida" fallara la primera vez (11/12-09-2026):
// "miami" SOLO (sin el equipo de acá) ya es un apodo real de Miami Marlins
// (MLB) y Miami Dolphins (NFL) — sin una entrada más ESPECÍFICA para "miami
// florida"/"miami hurricanes", el ticket se evaluaba por error contra esos
// equipos de verdad. Registrando acá el nombre COMPLETO del equipo de
// NCAAF, la regla ya existente de "el apodo más largo que CONTIENE al más
// corto gana" (ver evaluarJugada() en evaluador.js) hace que "miami
// florida"/"miami hurricanes" le gane a "miami" solo, sin tocar nada más
// del algoritmo. La MISMA idea se usó para elegir los apodos de todo lo
// que sigue: NCAAF comparte muchísimos apodos de mascota (Tigers, Bulldogs,
// Wildcats, Cougars...) entre varios programas A LA VEZ, y algunos con
// equipos YA registrados de otras ligas (ej. "cardinals" ya es de St. Louis
// Cardinals/MLB, "bears" ya es de Chicago Bears/NFL, "cowboys" ya es de
// Dallas Cowboys/NFL) — agregar esos apodos pelados de nuevo por accidente
// NO los vuelve "ambiguos que se preguntan" gratis: un objeto de JavaScript
// no puede tener 2 veces la MISMA clave (a diferencia de agregar el mismo
// apodo en DOS archivos de deporte distintos, que sí arma una lista de
// candidatos vía combinarBasesPorDeporte() más abajo) — si "tigers" se
// escribiera acá 4 veces (Auburn, LSU, Clemson, Missouri) para 4 escuelas
// distintas, solo la ÚLTIMA se quedaría, las otras 3 desaparecerían en
// silencio. Por eso la regla que se siguió acá, escuela por escuela:
//   1. SIEMPRE se agrega el nombre completo "escuela mascota" (ej. "lsu
//      tigers") — un string único garantizado, funciona igual que "houston
//      astros" en el diccionario de MLB.
//   2. Se agrega el nombre PELADO de la escuela (ej. "lsu", "alabama")
//      SALVO que esa palabra ya sea un apodo de otro equipo/otra liga en
//      CUALQUIER diccionario de este archivo (ej. NO se agregó "texas"
//      pelado para Texas Longhorns porque ya es Texas Rangers/MLB; NO se
//      agregó "florida" pelado para Florida Gators porque ya es Florida
//      Panthers/NHL; NO "arizona"/"colorado"/"utah"/"washington" porque ya
//      son ambiguos entre 2-4 ligas). En esos casos, la escuela solo se
//      reconoce con su nombre completo o su mascota (ver el punto 3).
//   3. Se agrega la MASCOTA sola (ej. "sooners", "buckeyes", "longhorns")
//      solo si NINGUNA otra escuela de esta MISMA lista comparte esa
//      mascota (ver el punto de arriba sobre por qué no se puede repetir
//      una clave) Y esa palabra no es ya un apodo pelado de otra liga (ej.
//      NO "bears" para Baylor -ya es Chicago Bears/NFL-, NO "eagles" para
//      Boston College -ya es Philadelphia Eagles/NFL-, NO "cowboys" para
//      Oklahoma State -ya es Dallas Cowboys/NFL-, NO "panthers" para
//      Pittsburgh -ya es ambiguo Carolina Panthers/NFL y Florida
//      Panthers/NHL-, NO "cardinals" para Louisville -ya es St. Louis
//      Cardinals/MLB, mismo criterio que ya se usó para el propio
//      "cardenales de arizona" de NFL-, NO "ducks" para Oregon -ya es
//      Anaheim Ducks/NHL-, NO "bruins" para UCLA -ya es Boston Bruins/NHL-,
//      NO "knights" para UCF -ya es Vegas Golden Knights/NHL-, NO
//      "cavaliers" para Virginia -ya es Cleveland Cavaliers/NBA-). Mascotas
//      COMPARTIDAS por 2+ escuelas de esta lista (Tigers: Auburn/LSU/
//      Clemson/Missouri; Bulldogs: Georgia/Mississippi State; Wildcats:
//      Arizona/Kentucky/Northwestern/Kansas State; Cougars: BYU/Houston)
//      tampoco se agregan sueltas — cada una queda solo con su nombre
//      completo.
//
// OJO al sumar MÁS escuelas más adelante (siguiendo el pedido original de
// "a medida que aparezcan en sábanas reales"): antes de agregar un apodo
// PELADO nuevo (mascota o nombre de escuela), repasar esta MISMA lista de
// arriba para no repetir sin querer una clave que ya exista acá (ej. si el
// día de mañana se agrega Utah State o Texas A&M... espera, Texas A&M ya
// está — el ejemplo real sería New Mexico State o Utah State, que también
// se apodan "Aggies": HOY "aggies" pelado apunta solo a Texas A&M porque es
// la única de esta lista, pero agregar una segunda escuela "Aggies" sin
// tocar esa clave la pisaría en silencio — hay que pasar las DOS a
// "escuela aggies" en ese momento, igual que ya se hizo acá con Tigers/
// Bulldogs/Wildcats/Cougars).
//
// Sigue siendo un subconjunto a propósito (Power 4 + Notre Dame, no los
// ~130 equipos de FBS ni ningún equipo de FCS/Grupo de 5) — se van
// agregando más programas a medida que aparezcan en sábanas reales, mismo
// criterio ya usado para ir sumando MLB/NFL/NHL/fútbol/NBA con el tiempo.
const DICCIONARIO_EQUIPOS_NCAAF_BASE = {
  'miami florida': { nombre: 'Miami (FL) Hurricanes', deporte: 'ncaaf' },
  'miami hurricanes': { nombre: 'Miami (FL) Hurricanes', deporte: 'ncaaf' },

  // --- SEC ---
  'alabama': { nombre: 'Alabama Crimson Tide', deporte: 'ncaaf' },
  'alabama crimson tide': { nombre: 'Alabama Crimson Tide', deporte: 'ncaaf' },
  'crimson tide': { nombre: 'Alabama Crimson Tide', deporte: 'ncaaf' },
  'arkansas': { nombre: 'Arkansas Razorbacks', deporte: 'ncaaf' },
  'arkansas razorbacks': { nombre: 'Arkansas Razorbacks', deporte: 'ncaaf' },
  'razorbacks': { nombre: 'Arkansas Razorbacks', deporte: 'ncaaf' },
  'auburn': { nombre: 'Auburn Tigers', deporte: 'ncaaf' },
  'auburn tigers': { nombre: 'Auburn Tigers', deporte: 'ncaaf' },
  'florida gators': { nombre: 'Florida Gators', deporte: 'ncaaf' },
  'gators': { nombre: 'Florida Gators', deporte: 'ncaaf' },
  'georgia': { nombre: 'Georgia Bulldogs', deporte: 'ncaaf' },
  'georgia bulldogs': { nombre: 'Georgia Bulldogs', deporte: 'ncaaf' },
  'kentucky': { nombre: 'Kentucky Wildcats', deporte: 'ncaaf' },
  'kentucky wildcats': { nombre: 'Kentucky Wildcats', deporte: 'ncaaf' },
  'lsu': { nombre: 'LSU Tigers', deporte: 'ncaaf' },
  'lsu tigers': { nombre: 'LSU Tigers', deporte: 'ncaaf' },
  'mississippi state': { nombre: 'Mississippi State Bulldogs', deporte: 'ncaaf' },
  'mississippi state bulldogs': { nombre: 'Mississippi State Bulldogs', deporte: 'ncaaf' },
  'miss state': { nombre: 'Mississippi State Bulldogs', deporte: 'ncaaf' },
  'missouri': { nombre: 'Missouri Tigers', deporte: 'ncaaf' },
  'missouri tigers': { nombre: 'Missouri Tigers', deporte: 'ncaaf' },
  'mizzou': { nombre: 'Missouri Tigers', deporte: 'ncaaf' },
  'ole miss': { nombre: 'Ole Miss Rebels', deporte: 'ncaaf' },
  'ole miss rebels': { nombre: 'Ole Miss Rebels', deporte: 'ncaaf' },
  'mississippi rebels': { nombre: 'Ole Miss Rebels', deporte: 'ncaaf' },
  // "rebels" pelado SE QUITÓ (12-09-2026): UNLV también es "Rebels" — ver
  // el bug de "Texas state" más abajo antes de volver a agregarlo pelado.
  'oklahoma': { nombre: 'Oklahoma Sooners', deporte: 'ncaaf' },
  'oklahoma sooners': { nombre: 'Oklahoma Sooners', deporte: 'ncaaf' },
  'sooners': { nombre: 'Oklahoma Sooners', deporte: 'ncaaf' },
  'south carolina': { nombre: 'South Carolina Gamecocks', deporte: 'ncaaf' },
  'south carolina gamecocks': { nombre: 'South Carolina Gamecocks', deporte: 'ncaaf' },
  // "gamecocks" pelado SE QUITÓ (12-09-2026): Jacksonville State también
  // es "Gamecocks" — ver el bug de "Texas state" más abajo.
  'tennessee volunteers': { nombre: 'Tennessee Volunteers', deporte: 'ncaaf' },
  'volunteers': { nombre: 'Tennessee Volunteers', deporte: 'ncaaf' },
  'vols': { nombre: 'Tennessee Volunteers', deporte: 'ncaaf' },
  'texas longhorns': { nombre: 'Texas Longhorns', deporte: 'ncaaf' },
  'longhorns': { nombre: 'Texas Longhorns', deporte: 'ncaaf' },
  'texas a&m': { nombre: 'Texas A&M Aggies', deporte: 'ncaaf' },
  'texas a&m aggies': { nombre: 'Texas A&M Aggies', deporte: 'ncaaf' },
  'tamu': { nombre: 'Texas A&M Aggies', deporte: 'ncaaf' },
  // "aggies" pelado SE QUITÓ (12-09-2026): New Mexico State y Utah State
  // también son "Aggies" — ver el bug de "Texas state" más abajo.
  'vanderbilt': { nombre: 'Vanderbilt Commodores', deporte: 'ncaaf' },
  'vanderbilt commodores': { nombre: 'Vanderbilt Commodores', deporte: 'ncaaf' },
  'commodores': { nombre: 'Vanderbilt Commodores', deporte: 'ncaaf' },

  // --- Big Ten ---
  'illinois': { nombre: 'Illinois Fighting Illini', deporte: 'ncaaf' },
  'illinois fighting illini': { nombre: 'Illinois Fighting Illini', deporte: 'ncaaf' },
  'fighting illini': { nombre: 'Illinois Fighting Illini', deporte: 'ncaaf' },
  'illini': { nombre: 'Illinois Fighting Illini', deporte: 'ncaaf' },
  'indiana hoosiers': { nombre: 'Indiana Hoosiers', deporte: 'ncaaf' },
  'hoosiers': { nombre: 'Indiana Hoosiers', deporte: 'ncaaf' },
  'iowa': { nombre: 'Iowa Hawkeyes', deporte: 'ncaaf' },
  'iowa hawkeyes': { nombre: 'Iowa Hawkeyes', deporte: 'ncaaf' },
  'hawkeyes': { nombre: 'Iowa Hawkeyes', deporte: 'ncaaf' },
  'maryland': { nombre: 'Maryland Terrapins', deporte: 'ncaaf' },
  'maryland terrapins': { nombre: 'Maryland Terrapins', deporte: 'ncaaf' },
  'terrapins': { nombre: 'Maryland Terrapins', deporte: 'ncaaf' },
  'terps': { nombre: 'Maryland Terrapins', deporte: 'ncaaf' },
  'michigan': { nombre: 'Michigan Wolverines', deporte: 'ncaaf' },
  'michigan wolverines': { nombre: 'Michigan Wolverines', deporte: 'ncaaf' },
  'wolverines': { nombre: 'Michigan Wolverines', deporte: 'ncaaf' },
  'michigan state': { nombre: 'Michigan State Spartans', deporte: 'ncaaf' },
  'michigan state spartans': { nombre: 'Michigan State Spartans', deporte: 'ncaaf' },
  // "spartans" pelado SE QUITÓ (12-09-2026): San Jose State también es
  // "Spartans" — ver el bug de "Texas state" más abajo.
  'minnesota golden gophers': { nombre: 'Minnesota Golden Gophers', deporte: 'ncaaf' },
  'golden gophers': { nombre: 'Minnesota Golden Gophers', deporte: 'ncaaf' },
  'gophers': { nombre: 'Minnesota Golden Gophers', deporte: 'ncaaf' },
  'nebraska': { nombre: 'Nebraska Cornhuskers', deporte: 'ncaaf' },
  'nebraska cornhuskers': { nombre: 'Nebraska Cornhuskers', deporte: 'ncaaf' },
  'cornhuskers': { nombre: 'Nebraska Cornhuskers', deporte: 'ncaaf' },
  'huskers': { nombre: 'Nebraska Cornhuskers', deporte: 'ncaaf' },
  'northwestern': { nombre: 'Northwestern Wildcats', deporte: 'ncaaf' },
  'northwestern wildcats': { nombre: 'Northwestern Wildcats', deporte: 'ncaaf' },
  'ohio state': { nombre: 'Ohio State Buckeyes', deporte: 'ncaaf' },
  'ohio state buckeyes': { nombre: 'Ohio State Buckeyes', deporte: 'ncaaf' },
  'buckeyes': { nombre: 'Ohio State Buckeyes', deporte: 'ncaaf' },
  'oregon': { nombre: 'Oregon Ducks', deporte: 'ncaaf' },
  'oregon ducks': { nombre: 'Oregon Ducks', deporte: 'ncaaf' },
  'penn state': { nombre: 'Penn State Nittany Lions', deporte: 'ncaaf' },
  'penn state nittany lions': { nombre: 'Penn State Nittany Lions', deporte: 'ncaaf' },
  'nittany lions': { nombre: 'Penn State Nittany Lions', deporte: 'ncaaf' },
  'purdue': { nombre: 'Purdue Boilermakers', deporte: 'ncaaf' },
  'purdue boilermakers': { nombre: 'Purdue Boilermakers', deporte: 'ncaaf' },
  'boilermakers': { nombre: 'Purdue Boilermakers', deporte: 'ncaaf' },
  'rutgers': { nombre: 'Rutgers Scarlet Knights', deporte: 'ncaaf' },
  'rutgers scarlet knights': { nombre: 'Rutgers Scarlet Knights', deporte: 'ncaaf' },
  'scarlet knights': { nombre: 'Rutgers Scarlet Knights', deporte: 'ncaaf' },
  'ucla': { nombre: 'UCLA Bruins', deporte: 'ncaaf' },
  'ucla bruins': { nombre: 'UCLA Bruins', deporte: 'ncaaf' },
  'usc': { nombre: 'USC Trojans', deporte: 'ncaaf' },
  'usc trojans': { nombre: 'USC Trojans', deporte: 'ncaaf' },
  // "trojans" pelado SE QUITÓ (12-09-2026): Troy también es "Trojans" —
  // ver el bug de "Texas state" más abajo.
  'washington huskies': { nombre: 'Washington Huskies', deporte: 'ncaaf' },
  // "huskies" pelado SE QUITÓ (12-09-2026): Northern Illinois y UConn
  // también son "Huskies" — ver el bug de "Texas state" más abajo.
  'uw huskies': { nombre: 'Washington Huskies', deporte: 'ncaaf' },
  'wisconsin': { nombre: 'Wisconsin Badgers', deporte: 'ncaaf' },
  'wisconsin badgers': { nombre: 'Wisconsin Badgers', deporte: 'ncaaf' },
  'badgers': { nombre: 'Wisconsin Badgers', deporte: 'ncaaf' },

  // --- Big 12 ---
  'arizona wildcats': { nombre: 'Arizona Wildcats', deporte: 'ncaaf' },
  'arizona state': { nombre: 'Arizona State Sun Devils', deporte: 'ncaaf' },
  'arizona state sun devils': { nombre: 'Arizona State Sun Devils', deporte: 'ncaaf' },
  'sun devils': { nombre: 'Arizona State Sun Devils', deporte: 'ncaaf' },
  'asu sun devils': { nombre: 'Arizona State Sun Devils', deporte: 'ncaaf' },
  'baylor': { nombre: 'Baylor Bears', deporte: 'ncaaf' },
  'baylor bears': { nombre: 'Baylor Bears', deporte: 'ncaaf' },
  'byu': { nombre: 'BYU Cougars', deporte: 'ncaaf' },
  'byu cougars': { nombre: 'BYU Cougars', deporte: 'ncaaf' },
  'cincinnati bearcats': { nombre: 'Cincinnati Bearcats', deporte: 'ncaaf' },
  'bearcats': { nombre: 'Cincinnati Bearcats', deporte: 'ncaaf' },
  'colorado buffaloes': { nombre: 'Colorado Buffaloes', deporte: 'ncaaf' },
  'buffaloes': { nombre: 'Colorado Buffaloes', deporte: 'ncaaf' },
  'houston cougars': { nombre: 'Houston Cougars', deporte: 'ncaaf' },
  'iowa state': { nombre: 'Iowa State Cyclones', deporte: 'ncaaf' },
  'iowa state cyclones': { nombre: 'Iowa State Cyclones', deporte: 'ncaaf' },
  'cyclones': { nombre: 'Iowa State Cyclones', deporte: 'ncaaf' },
  'kansas': { nombre: 'Kansas Jayhawks', deporte: 'ncaaf' },
  'kansas jayhawks': { nombre: 'Kansas Jayhawks', deporte: 'ncaaf' },
  'jayhawks': { nombre: 'Kansas Jayhawks', deporte: 'ncaaf' },
  'kansas state': { nombre: 'Kansas State Wildcats', deporte: 'ncaaf' },
  'kansas state wildcats': { nombre: 'Kansas State Wildcats', deporte: 'ncaaf' },
  'k-state': { nombre: 'Kansas State Wildcats', deporte: 'ncaaf' },
  'kstate': { nombre: 'Kansas State Wildcats', deporte: 'ncaaf' },
  'oklahoma state': { nombre: 'Oklahoma State Cowboys', deporte: 'ncaaf' },
  'oklahoma state cowboys': { nombre: 'Oklahoma State Cowboys', deporte: 'ncaaf' },
  'okstate': { nombre: 'Oklahoma State Cowboys', deporte: 'ncaaf' },
  'tcu': { nombre: 'TCU Horned Frogs', deporte: 'ncaaf' },
  'tcu horned frogs': { nombre: 'TCU Horned Frogs', deporte: 'ncaaf' },
  'horned frogs': { nombre: 'TCU Horned Frogs', deporte: 'ncaaf' },
  'texas tech': { nombre: 'Texas Tech Red Raiders', deporte: 'ncaaf' },
  'texas tech red raiders': { nombre: 'Texas Tech Red Raiders', deporte: 'ncaaf' },
  'red raiders': { nombre: 'Texas Tech Red Raiders', deporte: 'ncaaf' },
  'ttu red raiders': { nombre: 'Texas Tech Red Raiders', deporte: 'ncaaf' },
  'ucf': { nombre: 'UCF Knights', deporte: 'ncaaf' },
  'ucf knights': { nombre: 'UCF Knights', deporte: 'ncaaf' },
  'utah utes': { nombre: 'Utah Utes', deporte: 'ncaaf' },
  'utes': { nombre: 'Utah Utes', deporte: 'ncaaf' },
  'west virginia': { nombre: 'West Virginia Mountaineers', deporte: 'ncaaf' },
  'west virginia mountaineers': { nombre: 'West Virginia Mountaineers', deporte: 'ncaaf' },
  // "mountaineers" pelado SE QUITÓ (12-09-2026): Appalachian State
  // también es "Mountaineers" — ver el bug de "Texas state" más abajo.

  // --- ACC ---
  'boston college': { nombre: 'Boston College Eagles', deporte: 'ncaaf' },
  'boston college eagles': { nombre: 'Boston College Eagles', deporte: 'ncaaf' },
  'california': { nombre: 'California Golden Bears', deporte: 'ncaaf' },
  'california golden bears': { nombre: 'California Golden Bears', deporte: 'ncaaf' },
  'cal golden bears': { nombre: 'California Golden Bears', deporte: 'ncaaf' },
  'clemson': { nombre: 'Clemson Tigers', deporte: 'ncaaf' },
  'clemson tigers': { nombre: 'Clemson Tigers', deporte: 'ncaaf' },
  'duke': { nombre: 'Duke Blue Devils', deporte: 'ncaaf' },
  'duke blue devils': { nombre: 'Duke Blue Devils', deporte: 'ncaaf' },
  'blue devils': { nombre: 'Duke Blue Devils', deporte: 'ncaaf' },
  'florida state': { nombre: 'Florida State Seminoles', deporte: 'ncaaf' },
  'florida state seminoles': { nombre: 'Florida State Seminoles', deporte: 'ncaaf' },
  'seminoles': { nombre: 'Florida State Seminoles', deporte: 'ncaaf' },
  'fsu seminoles': { nombre: 'Florida State Seminoles', deporte: 'ncaaf' },
  'georgia tech': { nombre: 'Georgia Tech Yellow Jackets', deporte: 'ncaaf' },
  'georgia tech yellow jackets': { nombre: 'Georgia Tech Yellow Jackets', deporte: 'ncaaf' },
  'yellow jackets': { nombre: 'Georgia Tech Yellow Jackets', deporte: 'ncaaf' },
  'louisville': { nombre: 'Louisville Cardinals', deporte: 'ncaaf' },
  'louisville cardinals': { nombre: 'Louisville Cardinals', deporte: 'ncaaf' },
  'nc state': { nombre: 'NC State Wolfpack', deporte: 'ncaaf' },
  'north carolina state': { nombre: 'NC State Wolfpack', deporte: 'ncaaf' },
  'nc state wolfpack': { nombre: 'NC State Wolfpack', deporte: 'ncaaf' },
  'wolfpack': { nombre: 'NC State Wolfpack', deporte: 'ncaaf' },
  'north carolina': { nombre: 'North Carolina Tar Heels', deporte: 'ncaaf' },
  'north carolina tar heels': { nombre: 'North Carolina Tar Heels', deporte: 'ncaaf' },
  'unc tar heels': { nombre: 'North Carolina Tar Heels', deporte: 'ncaaf' },
  'tar heels': { nombre: 'North Carolina Tar Heels', deporte: 'ncaaf' },
  'pitt': { nombre: 'Pittsburgh Panthers', deporte: 'ncaaf' },
  'pittsburgh panthers': { nombre: 'Pittsburgh Panthers', deporte: 'ncaaf' },
  'smu': { nombre: 'SMU Mustangs', deporte: 'ncaaf' },
  'smu mustangs': { nombre: 'SMU Mustangs', deporte: 'ncaaf' },
  'mustangs': { nombre: 'SMU Mustangs', deporte: 'ncaaf' },
  'stanford': { nombre: 'Stanford Cardinal', deporte: 'ncaaf' },
  'stanford cardinal': { nombre: 'Stanford Cardinal', deporte: 'ncaaf' },
  'syracuse': { nombre: 'Syracuse Orange', deporte: 'ncaaf' },
  'syracuse orange': { nombre: 'Syracuse Orange', deporte: 'ncaaf' },
  'virginia': { nombre: 'Virginia Cavaliers', deporte: 'ncaaf' },
  'virginia cavaliers': { nombre: 'Virginia Cavaliers', deporte: 'ncaaf' },
  'virginia tech': { nombre: 'Virginia Tech Hokies', deporte: 'ncaaf' },
  'virginia tech hokies': { nombre: 'Virginia Tech Hokies', deporte: 'ncaaf' },
  'hokies': { nombre: 'Virginia Tech Hokies', deporte: 'ncaaf' },
  'wake forest': { nombre: 'Wake Forest Demon Deacons', deporte: 'ncaaf' },
  'wake forest demon deacons': { nombre: 'Wake Forest Demon Deacons', deporte: 'ncaaf' },
  'demon deacons': { nombre: 'Wake Forest Demon Deacons', deporte: 'ncaaf' },

  // --- Independiente ---
  'notre dame': { nombre: 'Notre Dame Fighting Irish', deporte: 'ncaaf' },
  'notre dame fighting irish': { nombre: 'Notre Dame Fighting Irish', deporte: 'ncaaf' },
  'fighting irish': { nombre: 'Notre Dame Fighting Irish', deporte: 'ncaaf' },

  // =================================================================
  // GRUPO DE 5 + INDEPENDIENTES RESTANTES (12-09-2026)
  // =================================================================
  // Se agregó TODA la Division I FBS que faltaba (AAC, Conference USA,
  // MAC, Mountain West, Sun Belt + independientes) para arreglar este
  // bug real que reportó un usuario:
  //
  //   "🏈 California rl +3.5 -104 / 🏈 Texas state rl -2.5 -110 —
  //   tengo este parley de ncaaf que se pierde pero en la sabana
  //   automatica lo marca como que se gana por que?"
  //
  // La causa: "Texas state" (Texas State Bobcats, Sun Belt) NO estaba en
  // el diccionario todavía. Como el apodo pelado "texas" YA existe (mlb,
  // Texas Rangers), la jugada se emparejaba por error contra los
  // Rangers de béisbol — un equipo real, con API real, pero totalmente
  // distinto — en vez de caer en SIN_MAPEO. Mismo tipo de bug que
  // "Miami Florida" del 06-09-2026, solo que con "texas" en vez de
  // "miami" como apodo corto pre-existente.
  //
  // El arreglo NO tocó el algoritmo: la regla "el apodo más largo que
  // CONTIENE al más corto gana" (evaluarJugada(), evaluador.js) ya
  // existía. Alcanzó con agregar 'texas state' (10 letras, contiene a
  // 'texas', 5 letras) para que gane automáticamente. El mismo patrón
  // se repite para OTRAS escuelas que corrían el mismo riesgo por
  // compartir texto con un apodo corto ya existente (ver comentarios
  // "pelado" que se quitaron más arriba en este archivo): "north texas"
  // contiene a "texas", "western kentucky" contiene a "kentucky",
  // "central michigan"/"eastern michigan"/"western michigan" contienen
  // a "michigan", "colorado state" contiene a "colorado", "missouri
  // state" contiene a "missouri", "utah state" contiene a "utah",
  // "arkansas state" contiene a "arkansas", "georgia southern"/"georgia
  // state" contienen a "georgia", "south alabama" contiene a "alabama",
  // "sam houston" contiene a "houston", "northern illinois" contiene a
  // "illinois".
  //
  // Mascotas repetidas DENTRO de este mismo grupo (Bobcats: Texas State
  // Y Ohio; Owls: Rice, Temple, FAU, Kennesaw State; Bulls: South
  // Florida Y Buffalo; Bulldogs: Louisiana Tech Y Fresno State; Rebels:
  // Ole Miss Y UNLV; Aggies: Texas A&M, New Mexico State Y Utah State;
  // Spartans: Michigan State Y San Jose State; Trojans: USC Y Troy;
  // Huskies: Washington, Northern Illinois Y UConn; Mountaineers: West
  // Virginia Y Appalachian State; Gamecocks: South Carolina Y
  // Jacksonville State; Panthers, Eagles, Falcons, Broncos, Cardinals,
  // Cowboys, Warhawks...) se dejaron DELIBERADAMENTE sin clave pelada:
  // solo quedan como clave compuesta "escuela + mascota" para no
  // pisarse entre sí (JS solo se queda con el ÚLTIMO valor de una clave
  // repetida DENTRO del mismo objeto — no es lo mismo que la ambigüedad
  // entre deportes de combinarBasesPorDeporte(), que sí suma candidatos).
  //
  // Verificado con un script de Node que compara la cantidad de claves
  // escritas contra las claves realmente presentes en el objeto (ver
  // notas del commit): 0 pisadas accidentales tras este cambio.

  // --- AAC ---
  'army': { nombre: 'Army Black Knights', deporte: 'ncaaf' },
  'army black knights': { nombre: 'Army Black Knights', deporte: 'ncaaf' },
  'black knights': { nombre: 'Army Black Knights', deporte: 'ncaaf' },
  'charlotte 49ers': { nombre: 'Charlotte 49ers', deporte: 'ncaaf' },
  'east carolina': { nombre: 'East Carolina Pirates', deporte: 'ncaaf' },
  'east carolina pirates': { nombre: 'East Carolina Pirates', deporte: 'ncaaf' },
  'ecu pirates': { nombre: 'East Carolina Pirates', deporte: 'ncaaf' },
  'florida atlantic': { nombre: 'Florida Atlantic Owls', deporte: 'ncaaf' },
  'florida atlantic owls': { nombre: 'Florida Atlantic Owls', deporte: 'ncaaf' },
  'fau owls': { nombre: 'Florida Atlantic Owls', deporte: 'ncaaf' },
  'memphis': { nombre: 'Memphis Tigers', deporte: 'ncaaf' },
  'memphis tigers': { nombre: 'Memphis Tigers', deporte: 'ncaaf' },
  'navy': { nombre: 'Navy Midshipmen', deporte: 'ncaaf' },
  'navy midshipmen': { nombre: 'Navy Midshipmen', deporte: 'ncaaf' },
  'midshipmen': { nombre: 'Navy Midshipmen', deporte: 'ncaaf' },
  'north texas': { nombre: 'North Texas Mean Green', deporte: 'ncaaf' },
  'north texas mean green': { nombre: 'North Texas Mean Green', deporte: 'ncaaf' },
  'unt mean green': { nombre: 'North Texas Mean Green', deporte: 'ncaaf' },
  'mean green': { nombre: 'North Texas Mean Green', deporte: 'ncaaf' },
  'rice': { nombre: 'Rice Owls', deporte: 'ncaaf' },
  'rice owls': { nombre: 'Rice Owls', deporte: 'ncaaf' },
  'south florida': { nombre: 'South Florida Bulls', deporte: 'ncaaf' },
  'south florida bulls': { nombre: 'South Florida Bulls', deporte: 'ncaaf' },
  'usf bulls': { nombre: 'South Florida Bulls', deporte: 'ncaaf' },
  'temple': { nombre: 'Temple Owls', deporte: 'ncaaf' },
  'temple owls': { nombre: 'Temple Owls', deporte: 'ncaaf' },
  'tulane': { nombre: 'Tulane Green Wave', deporte: 'ncaaf' },
  'tulane green wave': { nombre: 'Tulane Green Wave', deporte: 'ncaaf' },
  'green wave': { nombre: 'Tulane Green Wave', deporte: 'ncaaf' },
  'tulsa': { nombre: 'Tulsa Golden Hurricane', deporte: 'ncaaf' },
  'tulsa golden hurricane': { nombre: 'Tulsa Golden Hurricane', deporte: 'ncaaf' },
  'golden hurricane': { nombre: 'Tulsa Golden Hurricane', deporte: 'ncaaf' },
  'uab': { nombre: 'UAB Blazers', deporte: 'ncaaf' },
  'uab blazers': { nombre: 'UAB Blazers', deporte: 'ncaaf' },
  'utsa': { nombre: 'UTSA Roadrunners', deporte: 'ncaaf' },
  'utsa roadrunners': { nombre: 'UTSA Roadrunners', deporte: 'ncaaf' },
  'roadrunners': { nombre: 'UTSA Roadrunners', deporte: 'ncaaf' },

  // --- C-USA ---
  'delaware': { nombre: 'Delaware Blue Hens', deporte: 'ncaaf' },
  'delaware blue hens': { nombre: 'Delaware Blue Hens', deporte: 'ncaaf' },
  'blue hens': { nombre: 'Delaware Blue Hens', deporte: 'ncaaf' },
  'fiu': { nombre: 'FIU Panthers', deporte: 'ncaaf' },
  'fiu panthers': { nombre: 'FIU Panthers', deporte: 'ncaaf' },
  'florida international panthers': { nombre: 'FIU Panthers', deporte: 'ncaaf' },
  'jacksonville state': { nombre: 'Jacksonville State Gamecocks', deporte: 'ncaaf' },
  'jacksonville state gamecocks': { nombre: 'Jacksonville State Gamecocks', deporte: 'ncaaf' },
  'kennesaw state': { nombre: 'Kennesaw State Owls', deporte: 'ncaaf' },
  'kennesaw state owls': { nombre: 'Kennesaw State Owls', deporte: 'ncaaf' },
  'liberty': { nombre: 'Liberty Flames', deporte: 'ncaaf' },
  'liberty flames': { nombre: 'Liberty Flames', deporte: 'ncaaf' },
  'louisiana tech': { nombre: 'Louisiana Tech Bulldogs', deporte: 'ncaaf' },
  'louisiana tech bulldogs': { nombre: 'Louisiana Tech Bulldogs', deporte: 'ncaaf' },
  'middle tennessee': { nombre: 'Middle Tennessee Blue Raiders', deporte: 'ncaaf' },
  'middle tennessee blue raiders': { nombre: 'Middle Tennessee Blue Raiders', deporte: 'ncaaf' },
  'mtsu blue raiders': { nombre: 'Middle Tennessee Blue Raiders', deporte: 'ncaaf' },
  'blue raiders': { nombre: 'Middle Tennessee Blue Raiders', deporte: 'ncaaf' },
  'missouri state': { nombre: 'Missouri State Bears', deporte: 'ncaaf' },
  'missouri state bears': { nombre: 'Missouri State Bears', deporte: 'ncaaf' },
  'new mexico state': { nombre: 'New Mexico State Aggies', deporte: 'ncaaf' },
  'new mexico state aggies': { nombre: 'New Mexico State Aggies', deporte: 'ncaaf' },
  'sam houston': { nombre: 'Sam Houston Bearkats', deporte: 'ncaaf' },
  'sam houston state': { nombre: 'Sam Houston Bearkats', deporte: 'ncaaf' },
  'sam houston bearkats': { nombre: 'Sam Houston Bearkats', deporte: 'ncaaf' },
  'bearkats': { nombre: 'Sam Houston Bearkats', deporte: 'ncaaf' },
  'utep': { nombre: 'UTEP Miners', deporte: 'ncaaf' },
  'utep miners': { nombre: 'UTEP Miners', deporte: 'ncaaf' },
  'miners': { nombre: 'UTEP Miners', deporte: 'ncaaf' },
  'western kentucky': { nombre: 'Western Kentucky Hilltoppers', deporte: 'ncaaf' },
  'western kentucky hilltoppers': { nombre: 'Western Kentucky Hilltoppers', deporte: 'ncaaf' },
  'wku hilltoppers': { nombre: 'Western Kentucky Hilltoppers', deporte: 'ncaaf' },
  'hilltoppers': { nombre: 'Western Kentucky Hilltoppers', deporte: 'ncaaf' },

  // --- MAC ---
  'akron': { nombre: 'Akron Zips', deporte: 'ncaaf' },
  'akron zips': { nombre: 'Akron Zips', deporte: 'ncaaf' },
  'zips': { nombre: 'Akron Zips', deporte: 'ncaaf' },
  'ball state': { nombre: 'Ball State Cardinals', deporte: 'ncaaf' },
  'ball state cardinals': { nombre: 'Ball State Cardinals', deporte: 'ncaaf' },
  'bowling green': { nombre: 'Bowling Green Falcons', deporte: 'ncaaf' },
  'bowling green falcons': { nombre: 'Bowling Green Falcons', deporte: 'ncaaf' },
  'buffalo bulls': { nombre: 'Buffalo Bulls', deporte: 'ncaaf' },
  'central michigan': { nombre: 'Central Michigan Chippewas', deporte: 'ncaaf' },
  'central michigan chippewas': { nombre: 'Central Michigan Chippewas', deporte: 'ncaaf' },
  'chippewas': { nombre: 'Central Michigan Chippewas', deporte: 'ncaaf' },
  'eastern michigan': { nombre: 'Eastern Michigan Eagles', deporte: 'ncaaf' },
  'eastern michigan eagles': { nombre: 'Eastern Michigan Eagles', deporte: 'ncaaf' },
  'kent state': { nombre: 'Kent State Golden Flashes', deporte: 'ncaaf' },
  'kent state golden flashes': { nombre: 'Kent State Golden Flashes', deporte: 'ncaaf' },
  'golden flashes': { nombre: 'Kent State Golden Flashes', deporte: 'ncaaf' },
  'umass': { nombre: 'Massachusetts Minutemen', deporte: 'ncaaf' },
  'massachusetts minutemen': { nombre: 'Massachusetts Minutemen', deporte: 'ncaaf' },
  'umass minutemen': { nombre: 'Massachusetts Minutemen', deporte: 'ncaaf' },
  'minutemen': { nombre: 'Massachusetts Minutemen', deporte: 'ncaaf' },
  'miami oh': { nombre: 'Miami (OH) RedHawks', deporte: 'ncaaf' },
  'miami ohio': { nombre: 'Miami (OH) RedHawks', deporte: 'ncaaf' },
  'miami (oh)': { nombre: 'Miami (OH) RedHawks', deporte: 'ncaaf' },
  'miami (oh) redhawks': { nombre: 'Miami (OH) RedHawks', deporte: 'ncaaf' },
  'redhawks': { nombre: 'Miami (OH) RedHawks', deporte: 'ncaaf' },
  'northern illinois': { nombre: 'Northern Illinois Huskies', deporte: 'ncaaf' },
  'northern illinois huskies': { nombre: 'Northern Illinois Huskies', deporte: 'ncaaf' },
  'ohio bobcats': { nombre: 'Ohio Bobcats', deporte: 'ncaaf' },
  'toledo': { nombre: 'Toledo Rockets', deporte: 'ncaaf' },
  'toledo rockets': { nombre: 'Toledo Rockets', deporte: 'ncaaf' },
  'western michigan': { nombre: 'Western Michigan Broncos', deporte: 'ncaaf' },
  'western michigan broncos': { nombre: 'Western Michigan Broncos', deporte: 'ncaaf' },

  // --- Mountain West ---
  'air force': { nombre: 'Air Force Falcons', deporte: 'ncaaf' },
  'air force falcons': { nombre: 'Air Force Falcons', deporte: 'ncaaf' },
  'boise state': { nombre: 'Boise State Broncos', deporte: 'ncaaf' },
  'boise state broncos': { nombre: 'Boise State Broncos', deporte: 'ncaaf' },
  'colorado state': { nombre: 'Colorado State Rams', deporte: 'ncaaf' },
  'colorado state rams': { nombre: 'Colorado State Rams', deporte: 'ncaaf' },
  'fresno state': { nombre: 'Fresno State Bulldogs', deporte: 'ncaaf' },
  'fresno state bulldogs': { nombre: 'Fresno State Bulldogs', deporte: 'ncaaf' },
  'hawaii': { nombre: "Hawai'i Rainbow Warriors", deporte: 'ncaaf' },
  'hawaii rainbow warriors': { nombre: "Hawai'i Rainbow Warriors", deporte: 'ncaaf' },
  'rainbow warriors': { nombre: "Hawai'i Rainbow Warriors", deporte: 'ncaaf' },
  'nevada': { nombre: 'Nevada Wolf Pack', deporte: 'ncaaf' },
  'nevada wolf pack': { nombre: 'Nevada Wolf Pack', deporte: 'ncaaf' },
  'new mexico': { nombre: 'New Mexico Lobos', deporte: 'ncaaf' },
  'new mexico lobos': { nombre: 'New Mexico Lobos', deporte: 'ncaaf' },
  'lobos': { nombre: 'New Mexico Lobos', deporte: 'ncaaf' },
  'san diego state': { nombre: 'San Diego State Aztecs', deporte: 'ncaaf' },
  'san diego state aztecs': { nombre: 'San Diego State Aztecs', deporte: 'ncaaf' },
  'sdsu aztecs': { nombre: 'San Diego State Aztecs', deporte: 'ncaaf' },
  'aztecs': { nombre: 'San Diego State Aztecs', deporte: 'ncaaf' },
  'san jose state': { nombre: 'San Jose State Spartans', deporte: 'ncaaf' },
  'san jose state spartans': { nombre: 'San Jose State Spartans', deporte: 'ncaaf' },
  'unlv': { nombre: 'UNLV Rebels', deporte: 'ncaaf' },
  'unlv rebels': { nombre: 'UNLV Rebels', deporte: 'ncaaf' },
  'utah state': { nombre: 'Utah State Aggies', deporte: 'ncaaf' },
  'utah state aggies': { nombre: 'Utah State Aggies', deporte: 'ncaaf' },
  'wyoming': { nombre: 'Wyoming Cowboys', deporte: 'ncaaf' },
  'wyoming cowboys': { nombre: 'Wyoming Cowboys', deporte: 'ncaaf' },

  // --- Sun Belt ---
  'appalachian state': { nombre: 'Appalachian State Mountaineers', deporte: 'ncaaf' },
  'appalachian state mountaineers': { nombre: 'Appalachian State Mountaineers', deporte: 'ncaaf' },
  'app state': { nombre: 'Appalachian State Mountaineers', deporte: 'ncaaf' },
  'arkansas state': { nombre: 'Arkansas State Red Wolves', deporte: 'ncaaf' },
  'arkansas state red wolves': { nombre: 'Arkansas State Red Wolves', deporte: 'ncaaf' },
  'red wolves': { nombre: 'Arkansas State Red Wolves', deporte: 'ncaaf' },
  'coastal carolina': { nombre: 'Coastal Carolina Chanticleers', deporte: 'ncaaf' },
  'coastal carolina chanticleers': { nombre: 'Coastal Carolina Chanticleers', deporte: 'ncaaf' },
  'chanticleers': { nombre: 'Coastal Carolina Chanticleers', deporte: 'ncaaf' },
  'georgia southern': { nombre: 'Georgia Southern Eagles', deporte: 'ncaaf' },
  'georgia southern eagles': { nombre: 'Georgia Southern Eagles', deporte: 'ncaaf' },
  'georgia state': { nombre: 'Georgia State Panthers', deporte: 'ncaaf' },
  'georgia state panthers': { nombre: 'Georgia State Panthers', deporte: 'ncaaf' },
  'james madison': { nombre: 'James Madison Dukes', deporte: 'ncaaf' },
  'james madison dukes': { nombre: 'James Madison Dukes', deporte: 'ncaaf' },
  'jmu dukes': { nombre: 'James Madison Dukes', deporte: 'ncaaf' },
  'dukes': { nombre: 'James Madison Dukes', deporte: 'ncaaf' },
  'louisiana lafayette': { nombre: 'Louisiana Ragin Cajuns', deporte: 'ncaaf' },
  'louisiana ragin cajuns': { nombre: 'Louisiana Ragin Cajuns', deporte: 'ncaaf' },
  'ragin cajuns': { nombre: 'Louisiana Ragin Cajuns', deporte: 'ncaaf' },
  'louisiana monroe': { nombre: 'Louisiana-Monroe Warhawks', deporte: 'ncaaf' },
  'ul monroe': { nombre: 'Louisiana-Monroe Warhawks', deporte: 'ncaaf' },
  'ulm warhawks': { nombre: 'Louisiana-Monroe Warhawks', deporte: 'ncaaf' },
  'warhawks': { nombre: 'Louisiana-Monroe Warhawks', deporte: 'ncaaf' },
  'marshall': { nombre: 'Marshall Thundering Herd', deporte: 'ncaaf' },
  'marshall thundering herd': { nombre: 'Marshall Thundering Herd', deporte: 'ncaaf' },
  'thundering herd': { nombre: 'Marshall Thundering Herd', deporte: 'ncaaf' },
  'old dominion': { nombre: 'Old Dominion Monarchs', deporte: 'ncaaf' },
  'old dominion monarchs': { nombre: 'Old Dominion Monarchs', deporte: 'ncaaf' },
  'odu monarchs': { nombre: 'Old Dominion Monarchs', deporte: 'ncaaf' },
  'monarchs': { nombre: 'Old Dominion Monarchs', deporte: 'ncaaf' },
  'south alabama': { nombre: 'South Alabama Jaguars', deporte: 'ncaaf' },
  'south alabama jaguars': { nombre: 'South Alabama Jaguars', deporte: 'ncaaf' },
  'southern miss': { nombre: 'Southern Miss Golden Eagles', deporte: 'ncaaf' },
  'southern mississippi': { nombre: 'Southern Miss Golden Eagles', deporte: 'ncaaf' },
  'southern miss golden eagles': { nombre: 'Southern Miss Golden Eagles', deporte: 'ncaaf' },
  'golden eagles': { nombre: 'Southern Miss Golden Eagles', deporte: 'ncaaf' },
  'texas state': { nombre: 'Texas State Bobcats', deporte: 'ncaaf' },
  'texas state bobcats': { nombre: 'Texas State Bobcats', deporte: 'ncaaf' },
  'troy': { nombre: 'Troy Trojans', deporte: 'ncaaf' },
  'troy trojans': { nombre: 'Troy Trojans', deporte: 'ncaaf' },

  // --- Independiente ---
  'uconn': { nombre: 'UConn Huskies', deporte: 'ncaaf' },
  'uconn huskies': { nombre: 'UConn Huskies', deporte: 'ncaaf' },
  'connecticut huskies': { nombre: 'UConn Huskies', deporte: 'ncaaf' }
};

// =================================================================
// FORMA DE CADA ENTRADA: SIEMPRE UN ARRAY DE CANDIDATOS (28-08-2026)
// =================================================================
// Cada apodo apunta a un ARRAY de 1 o más candidatos `{ nombre, deporte }`
// — no a un solo objeto como antes. La inmensa mayoría de los apodos
// tienen un solo candidato (ej. "astros" -> [Houston Astros/mlb]) y se
// comportan exactamente igual que siempre. Pero un apodo que EXISTE en
// más de un deporte a la vez (ej. "houston" -> Houston Astros/mlb Y
// Houston Texans/nfl, ver el comentario arriba de
// DICCIONARIO_EQUIPOS_NFL_BASE) queda con 2+ candidatos en su array — es
// el evaluador (evaluarJugada, en evaluador.js) el que decide CUÁL de los
// candidatos es el correcto para cada jugada en particular, mirando
// primero si la jugada trae un marcador explícito (emoji o palabra como
// "NFL"), después qué equipo tiene partido ESE día, después el tamaño del
// número de la jugada, y por último un marcador de sección opcional en la
// sábana — nunca adivinando a ciegas. Ver evaluarJugada()/
// resolverCandidatoAmbiguo() en evaluador.js para el detalle.
//
// Hoy los apodos con 2+ candidatos son, a propósito, solo los nombres
// PELADOS de ciudad que tienen equipo de MLB y de NFL a la vez (Houston,
// Miami, Filadelfia, Tampa, Minnesota, Baltimore, Washington, San
// Francisco, Cleveland, Detroit, Atlanta, Seattle, Arizona, Pittsburgh,
// Cincinnati, Kansas City) — todos los demás apodos (nombres de mascota,
// nombres completos) siguen siendo de un solo deporte porque no hace
// falta más que eso para que no choquen. La desambiguación de esta
// sección es la red de seguridad para esos casos y para cuando en el
// futuro (fútbol, con equipos que SÍ se llaman igual que su ciudad en
// varios países) no se pueda evitar del todo.
function combinarBasesPorDeporte(...basesPorDeporte) {
  const combinado = {};
  basesPorDeporte.forEach(base => {
    Object.keys(base).forEach(apodo => {
      const clave = apodo.toLowerCase();
      const entrada = base[apodo];
      if (!combinado[clave]) {
        combinado[clave] = [entrada];
        return;
      }
      // Ya había un candidato con este apodo (de otro deporte) — se suma
      // como candidato ADICIONAL en vez de pisarlo, salvo que sea
      // exactamente el mismo equipo (no debería pasar, pero por las dudas
      // no se duplica).
      const yaEstaba = combinado[clave].some(c => c.nombre === entrada.nombre && c.deporte === entrada.deporte);
      if (!yaEstaba) combinado[clave].push(entrada);
    });
  });
  return combinado;
}

// Arma el diccionario final de un grupo en 3 capas, cada una pisando a la
// anterior si repite un apodo:
//   1. Base (código, fijo arriba, igual para todos — puede tener apodos
//      con más de 1 candidato, ver arriba)
//   2. Global (tabla equipos_globales — la administra el Súper-admin
//      desde superadmin.html, vale para TODOS los grupos)
//   3. Personalizado del grupo (tabla equipos_personalizados — privado de
//      cada grupo, tiene la última palabra: un grupo puede pisar incluso
//      un apodo global si lo necesita)
// `filasGlobales` es opcional (se puede seguir llamando con un solo
// argumento como antes, para no romper nada que ya la usara así).
//
// OJO: a diferencia de la capa Base (que puede sumar candidatos), las
// capas Global y Personalizado SIEMPRE fijan un único candidato y pisan
// cualquier ambigüedad que hubiera abajo — es decir, estas 2 capas ya son,
// de por sí, una forma de desambiguación manual: si "miami" fuera
// ambiguo en la Base, un Grupo que casi siempre juega MLB puede agregar su
// propio apodo personalizado "miami" -> Miami Marlins y así, para ESE
// Grupo, "miami" deja de ser ambiguo para siempre (sin afectar a los
// demás Grupos).
const DICCIONARIO_EQUIPOS_BASE_UNIDO = combinarBasesPorDeporte(
  DICCIONARIO_EQUIPOS_BASE,
  DICCIONARIO_EQUIPOS_NFL_BASE,
  DICCIONARIO_EQUIPOS_NHL_BASE,
  DICCIONARIO_EQUIPOS_SOCCER_BASE,
  DICCIONARIO_EQUIPOS_NBA_BASE,
  DICCIONARIO_EQUIPOS_NCAAF_BASE
);

function mezclarConPersonalizados(filasGlobales, filasPersonalizadas) {
  // Compatibilidad: si solo se pasó un argumento, es el viejo uso
  // (filasPersonalizadas) sin capa global.
  if (filasPersonalizadas === undefined) {
    filasPersonalizadas = filasGlobales;
    filasGlobales = null;
  }
  const dic = { ...DICCIONARIO_EQUIPOS_BASE_UNIDO };
  (filasGlobales || []).forEach(row => {
    dic[row.apodo.toLowerCase()] = [{ nombre: row.nombre_oficial, deporte: row.deporte }];
  });
  (filasPersonalizadas || []).forEach(row => {
    dic[row.apodo.toLowerCase()] = [{ nombre: row.nombre_oficial, deporte: row.deporte }];
  });
  return dic;
}

module.exports = { DICCIONARIO_EQUIPOS_BASE: DICCIONARIO_EQUIPOS_BASE_UNIDO, mezclarConPersonalizados };
