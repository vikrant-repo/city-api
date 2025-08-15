import { Controller, Get, Query } from "@nestjs/common";
import { CityService } from "./city.service";

@Controller("cities")
export class CityController {
  constructor(private readonly cityService: CityService) {}

  @Get()
  async getCities(
    @Query("country") country: string,
    @Query("page") page = 1,
    @Query("limit") limit = 10,
  ) {
    return await this.cityService.getCities(
      country,
      Number(page),
      Number(limit),
    );
  }
}
