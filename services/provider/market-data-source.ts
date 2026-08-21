/**
 * Pluggable market data source — replaces the hardcoded `{ price: '2.42' }`
 * mock with real or configurable data feeds.
 *
 * In demo mode, uses `MockMarketDataSource` (static price).
 * In production mode, uses `HttpMarketDataSource` (CoinGecko, Binance, etc.).
 */
export interface MarketDataResult {
  symbol: string;
  price: string;
  updatedAt: string;
  provider: string;
}

export interface MarketDataSource {
  getMarketData(symbol: string): Promise<MarketDataResult>;
}

/**
 * Mock data source for demo mode — returns a static price.
 */
export class MockMarketDataSource implements MarketDataSource {
  private providerAddress: string;

  constructor(providerAddress: string) {
    this.providerAddress = providerAddress;
  }

  async getMarketData(symbol: string): Promise<MarketDataResult> {
    return {
      symbol,
      price: '2.42',
      updatedAt: new Date().toISOString(),
      provider: this.providerAddress,
    };
  }
}

/**
 * HTTP-based market data source — fetches real prices from an API.
 * Supports CoinGecko (default) or any API returning { price, updatedAt }.
 */
export class HttpMarketDataSource implements MarketDataSource {
  private apiUrl: string;
  private apiKey?: string;
  private providerAddress: string;

  constructor(opts: { apiUrl: string; apiKey?: string; providerAddress: string }) {
    this.apiUrl = opts.apiUrl;
    this.apiKey = opts.apiKey;
    this.providerAddress = opts.providerAddress;
  }

  async getMarketData(symbol: string): Promise<MarketDataResult> {
    const url = this.buildUrl(symbol);
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      throw new Error(`Market data API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    return this.parseResponse(symbol, data);
  }

  private buildUrl(symbol: string): string {
    // CoinGecko format: /simple/price?ids=ethereum&vs_currencies=usd
    if (this.apiUrl.includes('coingecko.com')) {
      const coinId = this.symbolToCoinGeckoId(symbol);
      return `${this.apiUrl}/simple/price?ids=${coinId}&vs_currencies=usd&include_last_updated_at=true`;
    }
    // Generic API: append symbol as query param
    return `${this.apiUrl}?symbol=${encodeURIComponent(symbol)}`;
  }

  private symbolToCoinGeckoId(symbol: string): string {
    const map: Record<string, string> = {
      'ETH/USD': 'ethereum',
      'BTC/USD': 'bitcoin',
      'CC3/USD': 'creditcoin',
    };
    return map[symbol.toUpperCase()] ?? 'ethereum';
  }

  private parseResponse(symbol: string, data: Record<string, unknown>): MarketDataResult {
    // CoinGecko format
    if (this.apiUrl.includes('coingecko.com')) {
      const coinId = this.symbolToCoinGeckoId(symbol);
      const coinData = data[coinId] as Record<string, unknown> | undefined;
      const usd = coinData?.usd as number | undefined;
      const updatedAt = coinData?.last_updated_at as number | undefined;
      if (usd === undefined) throw new Error(`No price data for ${symbol}`);
      return {
        symbol,
        price: String(usd),
        updatedAt: updatedAt ? new Date(updatedAt * 1000).toISOString() : new Date().toISOString(),
        provider: this.providerAddress,
      };
    }

    // Generic format: expect { price, updatedAt }
    const price = data.price ?? data.value;
    if (price === undefined) throw new Error(`No price data for ${symbol}`);
    return {
      symbol,
      price: String(price),
      updatedAt: (data.updatedAt as string) ?? new Date().toISOString(),
      provider: this.providerAddress,
    };
  }
}

/**
 * Create the appropriate market data source based on env config.
 */
export function createMarketDataSource(providerAddress: string): MarketDataSource {
  const apiUrl = process.env.MARKET_DATA_API_URL;
  const apiKey = process.env.MARKET_DATA_API_KEY;

  if (apiUrl) {
    return new HttpMarketDataSource({ apiUrl, apiKey, providerAddress });
  }

  // Fallback to mock for demo mode
  return new MockMarketDataSource(providerAddress) as unknown as MarketDataSource;
}
