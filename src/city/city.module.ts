import { Module } from "@nestjs/common";
import { CityController } from "./city.controller";
import { CityService } from "./city.service";
import { HttpModule } from "@nestjs/axios";
import { CacheModule } from "@nestjs/cache-manager";

@Module({
  imports: [
    HttpModule,
    CacheModule.register({
      ttl: 600, // cache for 10 minutes
      max: 100, // optional: store up to 100 items
    }),
  ],
  controllers: [CityController],
  providers: [CityService],
})
export class CityModule {}
