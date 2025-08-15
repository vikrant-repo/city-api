import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { ConfigService } from "@nestjs/config";
import { AxiosError } from "axios";
import { CityList, LoginResponse } from "src/types";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";

interface PollutionApiResponse {
  meta: { page: number; totalPages: number };
  results: { name: string; pollution: number }[];
}

@Injectable()
export class CityService {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private readonly apiBase: string;
  private readonly username: string;
  private readonly password: string;

  // blacklist pattern for cities
  private readonly blacklistPatterns = [
    /\b(station|zone|district|powerplant|unknown|industrial|monitoring)\b/i,
    /\d+/,
  ];

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    this.apiBase = this.configService.getOrThrow<string>("API_BASE_URL");
    this.username = this.configService.getOrThrow<string>("API_USERNAME");
    this.password = this.configService.getOrThrow<string>("API_PASSWORD");
  }

  // Auth login
  private async login(): Promise<void> {
    const { token, refreshToken } = await this.post<LoginResponse>(
      `${this.apiBase}/auth/login`,
      { username: this.username, password: this.password },
    );
    this.accessToken = token;
    this.refreshToken = refreshToken;
  }

  // Get refreshToken
  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new UnauthorizedException("No refresh token available");
    }
    const { token, refreshToken } = await this.post<LoginResponse>(
      `${this.apiBase}/auth/refresh`,
      { refresh_token: this.refreshToken },
    );
    this.accessToken = token;
    this.refreshToken = refreshToken;
  }

  // Get attpservice
  private async get<T>(url: string, auth = false): Promise<T> {
    const headers =
      auth && this.accessToken
        ? { Authorization: `Bearer ${this.accessToken}` }
        : undefined;

    const { data } = await firstValueFrom(
      this.httpService.get<T>(url, { headers }),
    );
    return data;
  }

  private async post<T>(url: string, body: any): Promise<T> {
    const { data } = await firstValueFrom(this.httpService.post<T>(url, body));
    return data;
  }

  private async requestWithAuth<T>(url: string): Promise<T> {
    if (!this.accessToken) {
      await this.login();
    }

    try {
      return await this.get<T>(url, true);
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      console.log(" error.response?.status ", error.response?.status);
      if (error instanceof AxiosError && error.response?.status === 401) {
        await this.refreshAccessToken();
        return await this.get<T>(url, true);
      }
      throw error;
    }
  }

  // normalise function for city
  private normalizeCityName(name: string): string {
    return name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s*\([^)]*\)\s*/g, "")
      .trim()
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private async getCityDescription(cityName: string): Promise<string | null> {
    // wikipedia api
    const wikipediaApiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cityName)}`;
    try {
      const { extract } = await this.get<{ extract?: string }>(wikipediaApiUrl);
      return extract ?? null;
    } catch {
      return null;
    }
  }

  private async cleanResults(data: PollutionApiResponse, limit: number) {
    // removing corrupted city names
    const filteredCities = data.results
      .filter(({ name }) => {
        const normalized = name
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        return !this.blacklistPatterns.some((pattern) =>
          pattern.test(normalized),
        );
      })
      .map(({ name, pollution }) => ({
        name: this.normalizeCityName(name),
        pollution,
      }));

    // Update description of city name
    const citiesWithDescriptions = await Promise.all(
      filteredCities.map(async (city) => ({
        ...city,
        description: await this.getCityDescription(city.name),
      })),
    );

    return {
      page: data.meta.page,
      count: citiesWithDescriptions.length,
      limit,
      cities: citiesWithDescriptions,
    };
  }

  // Get cities list
  async getCities(
    country: string,
    page: number,
    limit: number,
  ): Promise<CityList> {
    // Check on country as its required
    if (!country?.trim()) {
      throw new BadRequestException("Country is required");
    }
    // Unique cache key for the request
    const cacheKey = `cities_${country}_${page}_${limit}`;

    // Check cached data, if present then return cached data
    const cachedData =
      (await this.cacheManager.get<CityList>(cacheKey)) ?? null;
    if (cachedData) {
      return cachedData;
    }

    // get fresh data if not in cache
    const url = `${this.apiBase}/pollution?country=${country}&page=${page}&limit=${limit}`;
    const cities = await this.requestWithAuth<PollutionApiResponse>(url);
    const formattedCities = this.cleanResults(cities, limit);

    // set data in cache
    await this.cacheManager.set(cacheKey, formattedCities, 60000);
    return formattedCities;
  }
}
