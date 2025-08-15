export interface LoginResponse {
  token: string;
  refreshToken: string;
}

export interface City {
  id: number;
  name: string;
  country: string;
}

export interface CityList {
  page: number;
  count: number;
  limit: number;
  cities: {
    name: string;
    pollution: number;
    description: string | null;
  }[];
}
