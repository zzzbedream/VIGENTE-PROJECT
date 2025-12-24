// src/lib/rut-validator.ts

export class RutValidator {
  static clean(rut: string): string {
    return rut.replace(/[^0-9kK\-]/g, '').toUpperCase();
  }

  static validate(rut: string): boolean {
    const cleanRut = this.clean(rut);
    if (!cleanRut.includes('-')) return false;

    const [num, dv] = cleanRut.split('-');
    if (!num || !dv) return false;

    let sum = 0;
    let mul = 2;

    for (let i = num.length - 1; i >= 0; i--) {
      sum += parseInt(num.charAt(i)) * mul;
      mul = mul === 7 ? 2 : mul + 1;
    }

    const expected = 11 - (sum % 11);
    let validDv: string;
    
    if (expected === 11) validDv = '0';
    else if (expected === 10) validDv = 'K';
    else validDv = expected.toString();

    return validDv === dv.toUpperCase();
  }
}