import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './typeorm.config';

export default new DataSource(buildDataSourceOptions());
