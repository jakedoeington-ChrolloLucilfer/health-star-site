const API_BASE = 'https://world.openfoodfacts.org';
const MAX_RESULTS = 12;
const SEARCH_CACHE_KEY = 'healthStarsSearchCacheV2';
const PRODUCT_CACHE_KEY = 'healthStarsProductCacheV2';
const DEBOUNCE_MS = 350;
const EUROPE_TERMS = [
  'france', 'germany', 'italy', 'spain', 'netherlands', 'belgium', 'european-union',
  'poland', 'sweden', 'denmark', 'ireland', 'portugal', 'austria', 'greece', 'finland',
  'norway', 'switzerland', 'romania', 'czech-republic', 'hungary'
];

const els = {
  searchInput: document.getElementById('searchInput'),
  searchBtn: document.getElementById('searchBtn'),
  regionSelect: document.getElementById('regionSelect'),
  statusMsg: document.getElementById('statusMsg'),
  spinner: document.getElementById('spinner'),
  resultsMeta: document.getElementById('resultsMeta'),
  results: document.getElementById('results'),
  emptyState: document.getElementById('emptyState'),
  productLoading: document.getElementById('productLoading'),
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

const memorySearchCache = loadLocalCache(SEARCH_CACHE_KEY);
const memoryProductCache = loadLocalCache(PRODUCT_CACHE_KEY);
let latestSearchToken = 0;
let latestRenderToken = 0;
let searchDebounceTimer = null;

els.searchBtn.addEventListener('click', () => {
  debouncedSearch();
});

els.searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    debouncedSearch();
  }
});

els.regionSelect.addEventListener('change', () => {
  if (els.searchInput.value.trim().length >= 3) {
    debouncedSearch();
  }
});

function debouncedSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => searchProducts(), DEBOUNCE_MS);
}

async function searchProducts() {
  const query = els.searchInput.value.trim();
  const region = els.regionSelect.value;

  if (query.length < 3) {
    setStatus('Type at least 3 letters to search.');
    els.results.innerHTML = '';
    hideResultsMeta();
    return;
  }

  const searchToken = ++latestSearchToken;
  const cacheKey = `${region}::${query.toLowerCase()}`;

  setBusy(true);
  setStatus(`Searching for “${query}”...`);
  els.results.innerHTML = '';
  hideResultsMeta();

  try {
    let products = memorySearchCache[cacheKey];
    let fromCache = true;

    if (!products) {
      fromCache = false;
      const fields = [
        'code', 'product_name', 'brands', 'image_front_small_url', 'countries_tags',
        'nutrition_grades', 'nova_group', 'additives_n', 'ingredients_n', 'nutriments'
      ].join(',');

      const url = `${API_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=24&fields=${fields}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Search request failed with ${res.status}`);
      const data = await res.json();
      products = (data.products || [])
        .filter(product => product.code && product.product_name)
        .filter(matchesRegion);

      products = sortProducts(products, query).slice(0, MAX_RESULTS);
      memorySearchCache[cacheKey] = products;
      saveLocalCache(SEARCH_CACHE_KEY, memorySearchCache);
    }

    if (searchToken !== latestSearchToken) return;

    if (!products.length) {
      setStatus('No matching products found. Try a broader term, a different spelling, or another region.');
      els.results.innerHTML = '';
      hideResultsMeta();
      return;
    }

    setStatus(`Showing the best ${products.length} result${products.length === 1 ? '' : 's'} for “${query}”.`);
    showResultsMeta(`${fromCache ? 'Loaded from cache.' : 'Loaded from API.'} Exact matches appear first. Ratings fill in after the cards show up.`);
    renderSearchResults(products);
    hydrateResultRatings(products, ++latestRenderToken);
  } catch (err) {
    console.error(err);
    setStatus('Search failed right now. Try again in a few seconds or try a more specific product name.');
    els.results.innerHTML = '';
    hideResultsMeta();
  } finally {
    if (searchToken === latestSearchToken) {
      setBusy(false);
    }
  }
}

function renderSearchResults(products) {
  els.results.innerHTML = products.map((product) => {
    const name = escapeHtml(product.product_name || 'Unnamed product');
    const brands = escapeHtml(product.brands || 'Unknown brand');
    const image = safeImage(product.image_front_small_url);
    const region = getRegionLabel(product);
    const quick = quickHealthBadge(product);

    return `
      <button class="result-card" data-code="${escapeHtml(product.code)}">
        <img src="${image}" alt="${name}">
        <div class="result-meta">
          <h4>${name}</h4>
          <p class="result-line">${brands}</p>
          <p class="result-line">${region} · ${quick}</p>
          <div class="rating-chip pending" id="chip-${escapeHtml(product.code)}">Scoring...</div>
        </div>
      </button>
    `;
  }).join('');

  document.querySelectorAll('.result-card').forEach(card => {
    card.addEventListener('click', () => loadProduct(card.dataset.code));
  });
}

async function hydrateResultRatings(products, renderToken) {
  for (const product of products) {
    if (renderToken !== latestRenderToken) return;

    const chip = document.getElementById(`chip-${cssEscape(product.code)}`);
    if (!chip) continue;

    const scoring = scoreProduct(product);
    chip.classList.remove('pending');
    chip.textContent = `${renderCompactStars(scoring.score)} ${scoring.score.toFixed(1)} · ${shortVerdict(scoring.score)}`;

    await pause(40);
  }
}

async function loadProduct(code) {
  showProductLoading();
  setStatus('Loading full product details...');

  try {
    let product = memoryProductCache[code];

    if (!product) {
      const fields = [
        'code', 'product_name', 'brands', 'image_front_url', 'countries_tags', 'ingredients_text_en', 'ingredients_text',
        'ingredients_n', 'additives_n', 'additives_tags', 'nutrition_grades', 'nutriscore_data', 'nova_group',
        'nutriments', 'labels_tags', 'allergens_tags', 'categories', 'ecoscore_grade'
      ].join(',');

      const url = `${API_BASE}/api/v2/product/${encodeURIComponent(code)}?fields=${fields}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Product request failed with ${res.status}`);
      const data = await res.json();
      if (!data.product) throw new Error('No product returned');
      product = data.product;
      memoryProductCache[code] = product;
      saveLocalCache(PRODUCT_CACHE_KEY, memoryProductCache);
    }

    const scoring = scoreProduct(product);
    renderProduct(product, scoring);
    setStatus('Product loaded.');
  } catch (err) {
    console.error(err);
    hideProductLoading();
    els.emptyState.classList.remove('hidden');
    setStatus('Could not load that product right now. Try another result or try again in a moment.');
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
  else if (nova === 2) { score += 0.25; reasons.push('NOVA 2 means a processed culinary ingredient, which is slightly better than average.'); }
  else if (nova === 3) { reasons.push('NOVA 3 is processed food, so the score stays around the middle.'); }
  else if (nova === 4) { score -= 0.75; reasons.push('NOVA 4 means ultra-processed, which lowers the score.'); }

  if (additives === 0) { score += 0.25; reasons.push('No listed additives gave the product a small boost.'); }
  else if (additives >= 3 && additives <= 4) { score -= 0.25; reasons.push('Several additives slightly lowered the score.'); }
  else if (additives >= 5) { score -= 0.5; reasons.push('A high additive count lowered the score more heavily.'); }
  else { reasons.push('A small number of additives had little effect.'); }

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
  hideProductLoading();
  els.emptyState.classList.add('hidden');
  els.productContent.classList.remove('hidden');

  const nutriments = product.nutriments || {};
  const additiveTags = (product.additives_tags || []).slice(0, 12);
  const ingredientsText = product.ingredients_text_en || product.ingredients_text || 'No ingredient list available.';

  els.productImage.src = safeImage(product.image_front_url, 'https://placehold.co/300x300?text=No+Image');
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

function sortProducts(products, query) {
  const q = query.toLowerCase();
  return [...products].sort((a, b) => {
    const aName = (a.product_name || '').toLowerCase();
    const bName = (b.product_name || '').toLowerCase();
    const aBrand = (a.brands || '').toLowerCase();
    const bBrand = (b.brands || '').toLowerCase();

    const aExact = aName === q || aBrand === q ? 1 : 0;
    const bExact = bName === q || bBrand === q ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;

    const aStarts = aName.startsWith(q) || aBrand.startsWith(q) ? 1 : 0;
    const bStarts = bName.startsWith(q) || bBrand.startsWith(q) ? 1 : 0;
    if (aStarts !== bStarts) return bStarts - aStarts;

    const aContains = aName.includes(q) || aBrand.includes(q) ? 1 : 0;
    const bContains = bName.includes(q) || bBrand.includes(q) ? 1 : 0;
    if (aContains !== bContains) return bContains - aContains;

    const aScore = baseSearchScore(a);
    const bScore = baseSearchScore(b);
    return bScore - aScore;
  });
}

function baseSearchScore(product) {
  let score = 0;
  const grade = (product.nutrition_grades || '').toLowerCase();
  const gradeMap = { a: 5, b: 4, c: 3, d: 2, e: 1 };
  score += gradeMap[grade] || 0;
  score += Math.max(0, 5 - Number(product.nova_group || 5));
  score += Math.max(0, 3 - Number(product.additives_n || 3));
  return score;
}

function matchesRegion(product) {
  const region = els.regionSelect.value;
  if (region === 'all') return true;

  const countries = (product.countries_tags || []).join(' ').toLowerCase();
  if (region === 'us') return countries.includes('united-states');
  if (region === 'europe') return EUROPE_TERMS.some(term => countries.includes(term));
  return true;
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

function shortVerdict(score) {
  if (score >= 4.5) return 'great';
  if (score >= 3.5) return 'good';
  if (score >= 2.5) return 'mixed';
  if (score >= 1.5) return 'weak';
  return 'poor';
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

function renderCompactStars(score) {
  return renderStars(score).replace(/⯪/g, '⯪');
}

function showProductLoading() {
  els.emptyState.classList.add('hidden');
  els.productContent.classList.add('hidden');
  els.productLoading.classList.remove('hidden');
}

function hideProductLoading() {
  els.productLoading.classList.add('hidden');
}

function setBusy(isBusy) {
  els.searchBtn.disabled = isBusy;
  els.searchBtn.textContent = isBusy ? 'Searching...' : 'Search';
  els.spinner.classList.toggle('hidden', !isBusy);
}

function setStatus(message) {
  els.statusMsg.textContent = message;
}

function showResultsMeta(message) {
  els.resultsMeta.textContent = message;
  els.resultsMeta.classList.remove('hidden');
}

function hideResultsMeta() {
  els.resultsMeta.classList.add('hidden');
  els.resultsMeta.textContent = '';
}

function prettyTag(tag) {
  return tag.replace(/^en:/, '').replace(/-/g, ' ');
}

function formatNum(num) {
  const value = Number(num);
  if (!Number.isFinite(value)) return 'N/A';
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(1);
}

function safeImage(src, fallback = 'https://placehold.co/100x100?text=Food') {
  return src || fallback;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function loadLocalCache(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
}

function saveLocalCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}
