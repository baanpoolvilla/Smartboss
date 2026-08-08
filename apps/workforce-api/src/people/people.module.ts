import { Module } from '@nestjs/common';
import { PeopleController } from './people.controller';
import { PeopleRepository } from './people.repository';
import { PeopleService } from './people.service';

@Module({
  controllers: [PeopleController],
  providers: [PeopleService, PeopleRepository],
  exports: [PeopleService, PeopleRepository],
})
export class PeopleModule {}
