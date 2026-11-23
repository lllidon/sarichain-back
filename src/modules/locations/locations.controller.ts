import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { CatalogQueryDto } from '../catalog/catalog-query.dto';
import { LocationsService } from './locations.service';

class LocationCityQueryDto extends CatalogQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^\d{1,10}$/)
  provinceCode?: string;
}

@ApiTags('locations')
@Controller(['locations', 'web/locations'])
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('provinces')
  provinces() { return this.locations.listProvinces(); }

  @Get('cities')
  cities(@Query() query: LocationCityQueryDto) {
    return this.locations.listCities(query.provinceCode, query);
  }

  @Get('cities/:code')
  city(@Param('code') code: string) { return this.locations.city(code); }
}
