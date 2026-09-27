import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  it('shows the file picker before a file is opened', async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Turn a tab into a piano tutorial');
    expect(el.querySelector('input[type=file]')).toBeTruthy();
  });
});
