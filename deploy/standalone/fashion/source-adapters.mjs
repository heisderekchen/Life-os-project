// Public, server-rendered catalog data; no private product API or credentials.
export function nikeCatalogPhotos(html, sourceURL) {
  const data = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!data) return [];
  let groups;
  try { groups = JSON.parse(data).props?.pageProps?.initialState?.Wall?.productGroupings; } catch { return []; }
  return (groups || []).flatMap(group => group.products || []).flatMap(product => {
    const page = product.pdpUrl?.url;
    const image = product.colorwayImages?.portraitURL;
    try {
      if (product.productType !== 'FOOTWEAR' || new URL(page).hostname !== 'www.nike.com' || new URL(image).hostname !== 'static.nike.com') return [];
      return [{ title: `Nike ${product.copy?.title || ''} ${product.copy?.subTitle || ''}`.trim(), url: page, image,
        catalogURL: sourceURL, productCode: product.productCode }];
    } catch { return []; }
  });
}
