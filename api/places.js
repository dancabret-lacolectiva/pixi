// PIXI — Google Places API proxy
// Vercel Serverless Function
// La API key vive en process.env.GOOGLE_PLACES_API_KEY (configurada en Vercel)

export default async function handler(req, res) {
  // CORS — permitir llamadas desde los dominios de PIXI
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'API key no configurada', verified: false });
  }

  try {
    const { businessName, city } = req.body || {};

    if (!businessName || !businessName.trim()) {
      return res.status(200).json({ verified: false, reason: 'sin_nombre' });
    }

    const query = `${businessName.trim()}${city ? ', ' + city.trim() : ''}`;

    // ─── PASO 1: Text Search → encontrar el place_id ───
    const searchRes = await fetch(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.businessStatus',
        },
        body: JSON.stringify({
          textQuery: query,
          languageCode: 'es',
          maxResultCount: 1,
        }),
      }
    );

    const searchData = await searchRes.json();

    if (!searchData.places || searchData.places.length === 0) {
      // No se encontró ficha — negocio no está en Google
      return res.status(200).json({
        verified: true,
        found: false,
        reason: 'no_encontrado',
      });
    }

    const place = searchData.places[0];
    const placeId = place.id;

    // ─── PASO 2: Place Details → datos completos ───
    const detailsRes = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask':
            'displayName,formattedAddress,rating,userRatingCount,photos,reviews,regularOpeningHours,websiteUri,nationalPhoneNumber,businessStatus,editorialSummary',
        },
      }
    );

    const details = await detailsRes.json();

    // ─── Procesar la respuesta ───
    const photoCount = Array.isArray(details.photos) ? details.photos.length : 0;
    const reviews = Array.isArray(details.reviews) ? details.reviews : [];
    const reviewCount = details.userRatingCount || 0;

    // ¿Responde reviews? — buscar si hay respuestas del dueño
    let respondedReviews = 0;
    reviews.forEach((rv) => {
      if (rv.authorAttribution && rv.text && rv.text.text) {
        // Google no expone owner responses directamente en este endpoint;
        // usamos heurística: si hay reviews recientes es señal de actividad
      }
    });

    const result = {
      verified: true,
      found: true,
      data: {
        name: details.displayName ? details.displayName.text : businessName,
        address: details.formattedAddress || '',
        rating: details.rating || 0,
        reviewCount: reviewCount,
        photoCount: photoCount,
        hasWebsite: !!details.websiteUri,
        hasPhone: !!details.nationalPhoneNumber,
        hasHours: !!(details.regularOpeningHours && details.regularOpeningHours.weekdayDescriptions),
        hasSummary: !!details.editorialSummary,
        businessStatus: details.businessStatus || 'UNKNOWN',
        // Señales calculadas
        profileCompleteness: calcCompleteness(details, photoCount, reviewCount),
      },
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error('Places API error:', err);
    // Fallo gracioso — PIXI sigue funcionando en modo declarativo
    return res.status(200).json({ verified: false, reason: 'error_api' });
  }
}

// Calcula qué tan completo está el perfil de Google Business (0-100)
function calcCompleteness(details, photoCount, reviewCount) {
  let score = 0;
  if (details.rating) score += 15;
  if (reviewCount >= 1) score += 10;
  if (reviewCount >= 10) score += 10;
  if (reviewCount >= 30) score += 10;
  if (photoCount >= 1) score += 15;
  if (photoCount >= 5) score += 10;
  if (details.websiteUri) score += 10;
  if (details.nationalPhoneNumber) score += 5;
  if (details.regularOpeningHours) score += 10;
  if (details.editorialSummary) score += 5;
  return Math.min(100, score);
}
