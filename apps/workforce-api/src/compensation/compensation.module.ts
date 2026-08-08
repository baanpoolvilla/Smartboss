import { Module } from '@nestjs/common';
import { PeopleModule } from '../people/people.module';
import { CompensationController } from './compensation.controller';
import { CompensationRepository, CompensationService } from './compensation.service';

@Module({
  imports: [PeopleModule],
  controllers: [CompensationController],
  providers: [CompensationService, CompensationRepository],
  exports: [CompensationService],
})
export class CompensationModule {}
