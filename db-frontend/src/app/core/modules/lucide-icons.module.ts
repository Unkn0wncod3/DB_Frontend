import { NgModule } from '@angular/core';
import { LucideAngularModule, icons as lucideIcons } from 'lucide-angular';

@NgModule({
  imports: [LucideAngularModule.pick(lucideIcons)],
  exports: [LucideAngularModule]
})
export class LucideIconsModule {}
