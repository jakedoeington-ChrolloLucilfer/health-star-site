const API_BASE = 'https://world.openfoodfacts.org';
const EUROPE_TERMS = [
  'france', 'germany', 'italy', 'spain', 'netherlands', 'belgium', 'european-union',
  'poland', 'sweden', 'denmark', 'ireland', 'portugal', 'austria', 'greece'
];

const els = {
  searchInput: document.getElementById('searchInput'),
  searchBtn: document.getElementById('searchBtn'),
  regionSelect: document.getElementById('regionSelect'),
  statusMsg: document.getElementById('statusMsg'),
  results: document.getElementById('results'),
  emptyState: document.getElementById('emptyState'),
  productContent: document.getElementById('productContent'),
  productImage: document.getElementById('productImage'),
  productRegion: document.getElementById('productRegion'),
  productName: document.getElementById('productName'),
  productBrand: document.getElementById('productBrand'),
  starLine: document.getElementById('starLine'),
  ratingText: document.getElementById('ratingText'),
  summaryText: document.getElementById('summaryText'),
  nutriScore: document.getElementById('nutriScore'),
  novaScore: document.getElementById('novaScore'),
  additiveCount: document.getElementById('additiveCount'),
  ingredientCount: document.getElementById('ingredientCount'),
  reasonList: document.getElementById('reasonList'),
  nutritionGrid: document.getElementById('nutritionGrid'),
  ingredientsText: document.getElementById('ingredientsText'),
  additivesTags: document.getElementById('additivesTags')
};

els.searchBtn.addEventListener('click', performSearch);
els.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') performSearch();
});

async function performSearch() {
  const term = els.searchInput.value.trim();
  if (term.length < 3) {
    setStatus('Enter at least 3 letters so the search stays accurate and API-friendly.');
    return;
  }

  setStatus('Searching free product database...');
  els.results.innerHTML = '';

  try {
    const url = `${API_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(term)}&search_simple=1&action=process&json=1&page_size=12&fields=code,product_name,brands,image_front_small_url,countries_tags,nutrition_grades,nova_group,additives_n`;
    const res = await fetch(url);
    const data = await res.json();
    const products = (data.products || []).filter(matchesRegion);

    if (!products.length) {
      setStatus('No matching products found for that region. Try a broader search.');
      return;
    }

    setStatus(`Found ${products.length} product${products.length === 1 ? '' : 's'}. Select one below.`);
    renderSearchResults(products);
  } catch (err) {
    console.error(err);
    setStatus('The API search failed. Please try again in a moment.');
  }
}

function matchesRegion(product) {
  const region = els.regionSelect.value;
  if (region === 'all') return true;

  const countries = (product.countries_tags || []).join(' ').toLowerCase();
  if (region === 'us') {
    return countries.includes('united-states');
  }
  if (region === 'europe') {
    return EUROPE_TERMS.some(term => countries.includes(term));
  }
  return true;
}

function renderSearchResults(products) {
  els.results.innerHTML = products.map((product) => {
    const name = escapeHtml(product.product_name || 'Unnamed product');
    const brands = escapeHtml(product.brands || 'Unknown brand');
    const image = product.image_front_small_url || 'https://placehold.co/100x100?text=Food';
    const region = getRegionLabel(product);
    const quick = quickHealthBadge(product);

    return `
      <button class="result-card" data-code="${product.code}">
        <img src="${image}" alt="${name}">
        <div class="result-meta">
          <h4>${name}</h4>
          <p>${brands}</p>
          <p>${region} · ${quick}</p>
        </div>
      </button>
    `;
  }).join('');

  document.querySelectorAll('.result-card').forEach(card => {
    card.addEventListener('click', () => loadProduct(card.dataset.code));
  });
}

async function loadProduct(code) {
  setStatus('Loading product details and ingredients...');
  try {
    const fields = [
      'product_name', 'brands', 'image_front_url', 'countries_tags', 'ingredients_text_en', 'ingredients_text',
      'ingredients_n', 'additives_n', 'additives_tags', 'nutrition_grades', 'nutriscore_data', 'nova_group',
      'nutriments', 'labels_tags', 'allergens_tags', 'categories', 'ecoscore_grade'
    ].join(',');

    const url = `${API_BASE}/api/v2/product/${encodeURIComponent(code)}?fields=${fields}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.product) {
      setStatus('Could not load that product.');
      return;
    }

    const product = data.product;
    const scoring = scoreProduct(product);
    renderProduct(product, scoring);
    setStatus('Product loaded.');
  } catch (err) {
    console.error(err);
    setStatus('Could not fetch product details right now.');
  }
}

function scoreProduct(product) {
  const reasons = [];
  let score = 3.0;

  const nutriments = product.nutriments || {};
  const nutri = (product.nutrition_grades || '').toLowerCase();
  const nova = Number(product.nova_group || 0);
  const additives = Number(product.additives_n || 0);
  const ingredientCount = Number(product.ingredients_n || 0);
  const sugar = Number(nutriments.sugars_100g ?? nutriments.sugars ?? 0);
  const salt = Number(nutriments.salt_100g ?? nutriments.salt ?? 0);
  const fiber = Number(nutriments.fiber_100g ?? nutriments.fiber ?? 0);
  const protein = Number(nutriments.proteins_100g ?? nutriments.proteins ?? 0);
  const satFat = Number(nutriments['saturated-fat_100g'] ?? nutriments['saturated-fat'] ?? 0);

  const nutriMap = { a: 5, b: 4.5, c: 3.5, d: 2, e: 1 };
  if (nutriMap[nutri]) {
    score = nutriMap[nutri];
    reasons.push(`Nutri-Score ${nutri.toUpperCase()} set the starting point to ${nutriMap[nutri]} stars.`);
  } else {
    reasons.push('No Nutri-Score was available, so the rating started from a neutral 3 stars.');
  }

  if (nova === 1) { score += 0.5; reasons.push('NOVA 1 means minimally processed food, which helps the score.'); }
  else if (nova === 2) { score += 0.25; reasons.push('NOVA 2 means processed culinary ingredient, which is slightly better than average.'); }
  else if (nova === 3) { reasons.push('NOVA 3 is processed food, so the score stays near the middle.'); }
  else if (nova === 4) { score -= 0.75; reasons.push('NOVA 4 means ultra-processed, which lowers the score.'); }

  if (additives === 0) { score += 0.25; reasons.push('No listed additives gave the product a small boost.'); }
  else if (additives >= 1 && additives <= 2) { reasons.push('A small number of additives had little effect.'); }
  else if (additives >= 3 && additives <= 4) { score -= 0.25; reasons.push('Several additives slightly lowered the score.'); }
  else if (additives >= 5) { score -= 0.5; reasons.push('A high additive count lowered the score more heavily.'); }

  if (sugar >= 20) { score -= 0.5; reasons.push(`Sugar is high at ${formatNum(sugar)}g per 100g.`); }
  else if (sugar <= 5 && sugar > 0) { score += 0.25; reasons.push(`Sugar is fairly low at ${formatNum(sugar)}g per 100g.`); }

  if (salt >= 1.5) { score -= 0.5; reasons.push(`Salt is high at ${formatNum(salt)}g per 100g.`); }
  else if (salt <= 0.3 && salt > 0) { score += 0.25; reasons.push(`Salt is low at ${formatNum(salt)}g per 100g.`); }

  if (fiber >= 6) { score += 0.35; reasons.push(`Fiber is strong at ${formatNum(fiber)}g per 100g.`); }
  else if (fiber >= 3) { score += 0.15; reasons.push(`Fiber is decent at ${formatNum(fiber)}g per 100g.`); }

  if (protein >= 10) { score += 0.2; reasons.push(`Protein is solid at ${formatNum(protein)}g per 100g.`); }
  if (satFat >= 5) { score -= 0.25; reasons.push(`Saturated fat is relatively high at ${formatNum(satFat)}g per 100g.`); }

  if (ingredientCount && ingredientCount <= 5) { score += 0.2; reasons.push('A shorter ingredient list slightly improved the score.'); }
  else if (ingredientCount >= 15) { score -= 0.2; reasons.push('A long ingredient list slightly lowered the score.'); }

  score = Math.max(0.5, Math.min(5, Math.round(score * 2) / 2));
  const verdict = getVerdict(score);

  return { score, reasons, verdict };
}

function renderProduct(product, scoring) {
  els.emptyState.classList.add('hidden');
  els.productContent.classList.remove('hidden');

  const nutriments = product.nutriments || {};
  const additiveTags = (product.additives_tags || []).slice(0, 12);
  const ingredientsText = product.ingredients_text_en || product.ingredients_text || 'No ingredient list available.';

  els.productImage.src = product.image_front_url || 'https://placehold.co/300x300?text=No+Image';
  els.productImage.onerror = () => { els.productImage.src = 'https://placehold.co/300x300?text=No+Image'; };
  els.productRegion.textContent = getRegionLabel(product);
  els.productName.textContent = product.product_name || 'Unnamed product';
  els.productBrand.textContent = product.brands || 'Unknown brand';
  els.starLine.innerHTML = renderStars(scoring.score);
  els.ratingText.textContent = `${scoring.score.toFixed(1)} / 5 stars`;
  els.summaryText.textContent = scoring.verdict;
  els.nutriScore.textContent = product.nutrition_grades ? product.nutrition_grades.toUpperCase() : 'N/A';
  els.novaScore.textContent = product.nova_group || 'N/A';
  els.additiveCount.textContent = product.additives_n ?? 0;
  els.ingredientCount.textContent = product.ingredients_n ?? 0;

  els.reasonList.innerHTML = scoring.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('');

  const nutritionItems = [
    ['Calories', nutriments['energy-kcal_100g'], 'kcal'],
    ['Sugar', nutriments.sugars_100g, 'g'],
    ['Salt', nutriments.salt_100g, 'g'],
    ['Fiber', nutriments.fiber_100g, 'g'],
    ['Protein', nutriments.proteins_100g, 'g'],
    ['Sat. fat', nutriments['saturated-fat_100g'], 'g']
  ];

  els.nutritionGrid.innerHTML = nutritionItems.map(([label, value, unit]) => `
    <div class="nutrient">
      <span>${label}</span>
      <strong>${value != null ? `${formatNum(value)} ${unit}` : 'N/A'}</strong>
    </div>
  `).join('');

  els.ingredientsText.textContent = ingredientsText;
  els.additivesTags.innerHTML = additiveTags.length
    ? additiveTags.map(tag => `<span class="tag">${escapeHtml(prettyTag(tag))}</span>`).join('')
    : '<span class="tag">No additives listed</span>';
}

function quickHealthBadge(product) {
  const grade = (product.nutrition_grades || '').toUpperCase() || 'N/A';
  const nova = product.nova_group || 'N/A';
  return `Nutri-Score ${grade} · NOVA ${nova}`;
}

function getRegionLabel(product) {
  const countries = (product.countries_tags || []).join(' ').toLowerCase();
  if (countries.includes('united-states')) return 'United States';
  if (EUROPE_TERMS.some(term => countries.includes(term))) return 'Europe';
  return 'Global';
}

function getVerdict(score) {
  if (score >= 4.5) return 'This looks like a strong choice overall based on the available nutrition and ingredient data.';
  if (score >= 3.5) return 'This seems fairly good, with a few tradeoffs depending on processing or nutrient balance.';
  if (score >= 2.5) return 'This is more mixed than clearly healthy or unhealthy.';
  if (score >= 1.5) return 'This product has several warning signs, especially around processing, additives, or nutrition.';
  return 'This scores poorly for health based on the available ingredient and nutrition data.';
}

function renderStars(score) {
  let html = '';
  for (let i = 1; i <= 5; i++) {
    if (score >= i) html += '★';
    else if (score >= i - 0.5) html += '⯪';
    else html += '☆';
  }
  return html;
}

function setStatus(message) {
  els.statusMsg.textContent = message;
}

function prettyTag(tag) {
  return tag.replace(/^en:/, '').replace(/-/g, ' ');
}

function formatNum(num) {
  return Number(num).toFixed(num >= 10 ? 0 : 1);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
