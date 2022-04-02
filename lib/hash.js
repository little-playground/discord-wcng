//naive implementation of tiger/192 hash
//wont go fast, but we only call it on short messages. should be fast enough.

function buf2hex(buffer) {
  return [...new Uint8Array(buffer)]
      .map(x => x.toString(16).padStart(2, '0'))
      .join('');
}

function swapBytes(buffer) {
  let array = buffer.split('');

  //why sauer?! why would you create a hex string with swapped nibbles?!
  for(let i = 0; i < array.length; i += 2) {
    let tmp = array[i + 0];
    array[i + 0] = array[i + 1];
    array[i + 1] = tmp;
  }

  return array.join('');
}

class hash {
  constructor() {
    this.table = new BigUint64Array(4*256);

    this._initTable();

    this.defines = {
      passes : 3,
    }
  }

  tiger(input) {
    let u64Length = 64 * Math.floor(input.length / 64);
    let u8Length = input.length - u64Length;
    let u64 = new BigUint64Array(input.slice(0, u64Length).buffer);
    let u8 = input.slice(u64Length, input.length);

    let res = new BigUint64Array(3);

    res[0] = 0x0123456789ABCDEFn;
    res[1] = 0xFEDCBA9876543210n;
    res[2] = 0xF096A5B4C3B2E187n;

    for(let i = 0; i < (u64Length / 8); i += 8) {
      this._tiger_compress(u64.slice(i, i + 8), res);
    }

    {
      let i = 0;
      let temp = new Uint8Array(64);
      
      for(; i < u8Length; i++) {
        temp[i] = u8[i];
      }

      temp[i++] = 1;
      for(; i & 7; i++) {
        temp[i] = 0;
      }

      if(i > 56) {
        for(; i < 64; i++) {
          temp[i] = 0;
        }
        this._tiger_compress(new BigUint64Array(temp.buffer), res);
        i = 0;
      }

      for(; i < 56; i++) {
        temp[i] = 0;
      }

      {
        let u64Array = new BigUint64Array(temp.buffer);
        u64Array[7] = BigInt(input.length) * 8n;
        this._tiger_compress(u64Array, res);
      }
    }

    return new Uint8Array(res.buffer);
  }

  tigerStr(string) {
    let bytes = new TextEncoder().encode(string);

    return swapBytes(buf2hex(this.tiger(bytes)));
  }

  _t1(index) { return this.table[index]; }
  _t2(index) { return this.table[index + 256]; }
  _t3(index) { return this.table[index + 512]; }
  _t4(index) { return this.table[index + 768]; }

  _round(obj, x, mul) {
    let tmp = new BigUint64Array(3);
    tmp[0] = obj[0]; tmp[1] = obj[1]; tmp[2] = obj[2];
    
    tmp[2] ^= x;
    tmp[0] -=
      this._t1(Number((tmp[2]>>(0n*8n))&0xFFn)) ^
      this._t2(Number((tmp[2]>>(2n*8n))&0xFFn)) ^
      this._t3(Number((tmp[2]>>(4n*8n))&0xFFn)) ^
      this._t4(Number((tmp[2]>>(6n*8n))&0xFFn));
      tmp[1] +=
      this._t4(Number((tmp[2]>>(1n*8n))&0xFFn)) ^
      this._t3(Number((tmp[2]>>(3n*8n))&0xFFn)) ^
      this._t2(Number((tmp[2]>>(5n*8n))&0xFFn)) ^
      this._t1(Number((tmp[2]>>(7n*8n))&0xFFn));
      tmp[1] *= mul;
    
    obj[0] = tmp[0]; obj[1] = tmp[1]; obj[2] = tmp[2];
  }

  _rot(rot) {
    let tmp = new BigUint64Array(3); tmp[0] = rot[0]; tmp[1] = rot[1]; tmp[2] = rot[2];
    rot[0] = tmp[1]; rot[1] = tmp[2]; rot[2] = tmp[0];
  }

  _pass(obj, x, mul) {
    let tmp = new BigUint64Array(3);
    tmp[0] = obj[0]; tmp[1] = obj[1]; tmp[2] = obj[2];
    this._round(tmp, x[0], mul); this._rot(tmp);
    this._round(tmp, x[1], mul); this._rot(tmp);
    this._round(tmp, x[2], mul); this._rot(tmp);
    this._round(tmp, x[3], mul); this._rot(tmp);
    this._round(tmp, x[4], mul); this._rot(tmp);
    this._round(tmp, x[5], mul); this._rot(tmp);
    this._round(tmp, x[6], mul); this._rot(tmp);
    this._round(tmp, x[7], mul); this._rot(tmp); this._rot(tmp);
    obj[0] = tmp[0]; obj[1] = tmp[1]; obj[2] = tmp[2];
  }

  _key_schedule(str) {
    let x = new BigUint64Array(8);
    x[0] = str[0]; x[1] = str[1]; x[2] = str[2]; x[3] = str[3];
    x[4] = str[4]; x[5] = str[5]; x[6] = str[6]; x[7] = str[7];
    x[0] -= x[7] ^ 0xA5A5A5A5A5A5A5A5n;
    x[1] ^= x[0];
    x[2] += x[1];
    x[3] -= x[2] ^ ((~x[1])<<19n);
    x[4] ^= x[3];
    x[5] += x[4];
    x[6] -= x[5] ^ ((x[4] ^ 0xFFFFFFFFFFFFFFFFn)>>23n);
    x[7] ^= x[6];
    x[0] += x[7];
    x[1] -= x[0] ^ ((x[7] ^ 0xFFFFFFFFFFFFFFFFn)<<19n);
    x[2] ^= x[1];
    x[3] += x[2];
    x[4] -= x[3] ^ ((x[2] ^ 0xFFFFFFFFFFFFFFFFn)>>23n);
    x[5] ^= x[4];
    x[6] += x[5];
    x[7] -= x[6] ^ 0x0123456789ABCDEFn;
    str[0] = x[0]; str[1] = x[1]; str[2] = x[2]; str[3] = x[3];
    str[4] = x[4]; str[5] = x[5]; str[6] = x[6]; str[7] = x[7];
  }

  _tiger_compress(str, state) {
    let obj = new BigUint64Array(3);
    let objSave = new BigUint64Array(3);

    obj[0] = state[0];
    obj[1] = state[1];
    obj[2] = state[2];
    objSave[0] = state[0];
    objSave[1] = state[1];
    objSave[2] = state[2];

    for(let passNo = 0; passNo < this.defines.passes; passNo++) {
      if(0 != passNo) {
        this._key_schedule(str);
      }

      {
        let mul = (0 == passNo) ? 5n : ((1 == passNo) ? 7n : 9n);
        this._pass(obj, str, mul);
      }

      let tmpA = obj[0]; obj[0] = obj[2]; obj[2] = obj[1]; obj[1] = tmpA;
    }

    state[0] = obj[0] ^ objSave[0];
    state[1] = obj[1] - objSave[1];
    state[2] = obj[2] + objSave[2];
  }
  
  _initTable() {
    this.table[0]    = 0x02AAB17CF7E90C5En; this.table[1]    = 0xAC424B03E243A8ECn; this.table[2]    = 0x72CD5BE30DD5FCD3n; this.table[3]    = 0x6D019B93F6F97F3An;
    this.table[4]    = 0xCD9978FFD21F9193n; this.table[5]    = 0x7573A1C9708029E2n; this.table[6]    = 0xB164326B922A83C3n; this.table[7]    = 0x46883EEE04915870n;
    this.table[8]    = 0xEAACE3057103ECE6n; this.table[9]    = 0xC54169B808A3535Cn; this.table[10]   = 0x4CE754918DDEC47Cn; this.table[11]   = 0x0AA2F4DFDC0DF40Cn;
    this.table[12]   = 0x10B76F18A74DBEFAn; this.table[13]   = 0xC6CCB6235AD1AB6An; this.table[14]   = 0x13726121572FE2FFn; this.table[15]   = 0x1A488C6F199D921En;
    this.table[16]   = 0x4BC9F9F4DA0007CAn; this.table[17]   = 0x26F5E6F6E85241C7n; this.table[18]   = 0x859079DBEA5947B6n; this.table[19]   = 0x4F1885C5C99E8C92n;
    this.table[20]   = 0xD78E761EA96F864Bn; this.table[21]   = 0x8E36428C52B5C17Dn; this.table[22]   = 0x69CF6827373063C1n; this.table[23]   = 0xB607C93D9BB4C56En;
    this.table[24]   = 0x7D820E760E76B5EAn; this.table[25]   = 0x645C9CC6F07FDC42n; this.table[26]   = 0xBF38A078243342E0n; this.table[27]   = 0x5F6B343C9D2E7D04n;
    this.table[28]   = 0xF2C28AEB600B0EC6n; this.table[29]   = 0x6C0ED85F7254BCACn; this.table[30]   = 0x71592281A4DB4FE5n; this.table[31]   = 0x1967FA69CE0FED9Fn;
    this.table[32]   = 0xFD5293F8B96545DBn; this.table[33]   = 0xC879E9D7F2A7600Bn; this.table[34]   = 0x860248920193194En; this.table[35]   = 0xA4F9533B2D9CC0B3n;
    this.table[36]   = 0x9053836C15957613n; this.table[37]   = 0xDB6DCF8AFC357BF1n; this.table[38]   = 0x18BEEA7A7A370F57n; this.table[39]   = 0x037117CA50B99066n;
    this.table[40]   = 0x6AB30A9774424A35n; this.table[41]   = 0xF4E92F02E325249Bn; this.table[42]   = 0x7739DB07061CCAE1n; this.table[43]   = 0xD8F3B49CECA42A05n;
    this.table[44]   = 0xBD56BE3F51382F73n; this.table[45]   = 0x45FAED5843B0BB28n; this.table[46]   = 0x1C813D5C11BF1F83n; this.table[47]   = 0x8AF0E4B6D75FA169n;
    this.table[48]   = 0x33EE18A487AD9999n; this.table[49]   = 0x3C26E8EAB1C94410n; this.table[50]   = 0xB510102BC0A822F9n; this.table[51]   = 0x141EEF310CE6123Bn;
    this.table[52]   = 0xFC65B90059DDB154n; this.table[53]   = 0xE0158640C5E0E607n; this.table[54]   = 0x884E079826C3A3CFn; this.table[55]   = 0x930D0D9523C535FDn;
    this.table[56]   = 0x35638D754E9A2B00n; this.table[57]   = 0x4085FCCF40469DD5n; this.table[58]   = 0xC4B17AD28BE23A4Cn; this.table[59]   = 0xCAB2F0FC6A3E6A2En;
    this.table[60]   = 0x2860971A6B943FCDn; this.table[61]   = 0x3DDE6EE212E30446n; this.table[62]   = 0x6222F32AE01765AEn; this.table[63]   = 0x5D550BB5478308FEn;
    this.table[64]   = 0xA9EFA98DA0EDA22An; this.table[65]   = 0xC351A71686C40DA7n; this.table[66]   = 0x1105586D9C867C84n; this.table[67]   = 0xDCFFEE85FDA22853n;
    this.table[68]   = 0xCCFBD0262C5EEF76n; this.table[69]   = 0xBAF294CB8990D201n; this.table[70]   = 0xE69464F52AFAD975n; this.table[71]   = 0x94B013AFDF133E14n;
    this.table[72]   = 0x06A7D1A32823C958n; this.table[73]   = 0x6F95FE5130F61119n; this.table[74]   = 0xD92AB34E462C06C0n; this.table[75]   = 0xED7BDE33887C71D2n;
    this.table[76]   = 0x79746D6E6518393En; this.table[77]   = 0x5BA419385D713329n; this.table[78]   = 0x7C1BA6B948A97564n; this.table[79]   = 0x31987C197BFDAC67n;
    this.table[80]   = 0xDE6C23C44B053D02n; this.table[81]   = 0x581C49FED002D64Dn; this.table[82]   = 0xDD474D6338261571n; this.table[83]   = 0xAA4546C3E473D062n;
    this.table[84]   = 0x928FCE349455F860n; this.table[85]   = 0x48161BBACAAB94D9n; this.table[86]   = 0x63912430770E6F68n; this.table[87]   = 0x6EC8A5E602C6641Cn;
    this.table[88]   = 0x87282515337DDD2Bn; this.table[89]   = 0x2CDA6B42034B701Bn; this.table[90]   = 0xB03D37C181CB096Dn; this.table[91]   = 0xE108438266C71C6Fn;
    this.table[92]   = 0x2B3180C7EB51B255n; this.table[93]   = 0xDF92B82F96C08BBCn; this.table[94]   = 0x5C68C8C0A632F3BAn; this.table[95]   = 0x5504CC861C3D0556n;
    this.table[96]   = 0xABBFA4E55FB26B8Fn; this.table[97]   = 0x41848B0AB3BACEB4n; this.table[98]   = 0xB334A273AA445D32n; this.table[99]   = 0xBCA696F0A85AD881n;
    this.table[100]  = 0x24F6EC65B528D56Cn; this.table[101]  = 0x0CE1512E90F4524An; this.table[102]  = 0x4E9DD79D5506D35An; this.table[103]  = 0x258905FAC6CE9779n;
    this.table[104]  = 0x2019295B3E109B33n; this.table[105]  = 0xF8A9478B73A054CCn; this.table[106]  = 0x2924F2F934417EB0n; this.table[107]  = 0x3993357D536D1BC4n;
    this.table[108]  = 0x38A81AC21DB6FF8Bn; this.table[109]  = 0x47C4FBF17D6016BFn; this.table[110]  = 0x1E0FAADD7667E3F5n; this.table[111]  = 0x7ABCFF62938BEB96n;
    this.table[112]  = 0xA78DAD948FC179C9n; this.table[113]  = 0x8F1F98B72911E50Dn; this.table[114]  = 0x61E48EAE27121A91n; this.table[115]  = 0x4D62F7AD31859808n;
    this.table[116]  = 0xECEBA345EF5CEAEBn; this.table[117]  = 0xF5CEB25EBC9684CEn; this.table[118]  = 0xF633E20CB7F76221n; this.table[119]  = 0xA32CDF06AB8293E4n;
    this.table[120]  = 0x985A202CA5EE2CA4n; this.table[121]  = 0xCF0B8447CC8A8FB1n; this.table[122]  = 0x9F765244979859A3n; this.table[123]  = 0xA8D516B1A1240017n;
    this.table[124]  = 0x0BD7BA3EBB5DC726n; this.table[125]  = 0xE54BCA55B86ADB39n; this.table[126]  = 0x1D7A3AFD6C478063n; this.table[127]  = 0x519EC608E7669EDDn;
    this.table[128]  = 0x0E5715A2D149AA23n; this.table[129]  = 0x177D4571848FF194n; this.table[130]  = 0xEEB55F3241014C22n; this.table[131]  = 0x0F5E5CA13A6E2EC2n;
    this.table[132]  = 0x8029927B75F5C361n; this.table[133]  = 0xAD139FABC3D6E436n; this.table[134]  = 0x0D5DF1A94CCF402Fn; this.table[135]  = 0x3E8BD948BEA5DFC8n;
    this.table[136]  = 0xA5A0D357BD3FF77En; this.table[137]  = 0xA2D12E251F74F645n; this.table[138]  = 0x66FD9E525E81A082n; this.table[139]  = 0x2E0C90CE7F687A49n;
    this.table[140]  = 0xC2E8BCBEBA973BC5n; this.table[141]  = 0x000001BCE509745Fn; this.table[142]  = 0x423777BBE6DAB3D6n; this.table[143]  = 0xD1661C7EAEF06EB5n;
    this.table[144]  = 0xA1781F354DAACFD8n; this.table[145]  = 0x2D11284A2B16AFFCn; this.table[146]  = 0xF1FC4F67FA891D1Fn; this.table[147]  = 0x73ECC25DCB920ADAn;
    this.table[148]  = 0xAE610C22C2A12651n; this.table[149]  = 0x96E0A810D356B78An; this.table[150]  = 0x5A9A381F2FE7870Fn; this.table[151]  = 0xD5AD62EDE94E5530n;
    this.table[152]  = 0xD225E5E8368D1427n; this.table[153]  = 0x65977B70C7AF4631n; this.table[154]  = 0x99F889B2DE39D74Fn; this.table[155]  = 0x233F30BF54E1D143n;
    this.table[156]  = 0x9A9675D3D9A63C97n; this.table[157]  = 0x5470554FF334F9A8n; this.table[158]  = 0x166ACB744A4F5688n; this.table[159]  = 0x70C74CAAB2E4AEADn;
    this.table[160]  = 0xF0D091646F294D12n; this.table[161]  = 0x57B82A89684031D1n; this.table[162]  = 0xEFD95A5A61BE0B6Bn; this.table[163]  = 0x2FBD12E969F2F29An;
    this.table[164]  = 0x9BD37013FEFF9FE8n; this.table[165]  = 0x3F9B0404D6085A06n; this.table[166]  = 0x4940C1F3166CFE15n; this.table[167]  = 0x09542C4DCDF3DEFBn;
    this.table[168]  = 0xB4C5218385CD5CE3n; this.table[169]  = 0xC935B7DC4462A641n; this.table[170]  = 0x3417F8A68ED3B63Fn; this.table[171]  = 0xB80959295B215B40n;
    this.table[172]  = 0xF99CDAEF3B8C8572n; this.table[173]  = 0x018C0614F8FCB95Dn; this.table[174]  = 0x1B14ACCD1A3ACDF3n; this.table[175]  = 0x84D471F200BB732Dn;
    this.table[176]  = 0xC1A3110E95E8DA16n; this.table[177]  = 0x430A7220BF1A82B8n; this.table[178]  = 0xB77E090D39DF210En; this.table[179]  = 0x5EF4BD9F3CD05E9Dn;
    this.table[180]  = 0x9D4FF6DA7E57A444n; this.table[181]  = 0xDA1D60E183D4A5F8n; this.table[182]  = 0xB287C38417998E47n; this.table[183]  = 0xFE3EDC121BB31886n;
    this.table[184]  = 0xC7FE3CCC980CCBEFn; this.table[185]  = 0xE46FB590189BFD03n; this.table[186]  = 0x3732FD469A4C57DCn; this.table[187]  = 0x7EF700A07CF1AD65n;
    this.table[188]  = 0x59C64468A31D8859n; this.table[189]  = 0x762FB0B4D45B61F6n; this.table[190]  = 0x155BAED099047718n; this.table[191]  = 0x68755E4C3D50BAA6n;
    this.table[192]  = 0xE9214E7F22D8B4DFn; this.table[193]  = 0x2ADDBF532EAC95F4n; this.table[194]  = 0x32AE3909B4BD0109n; this.table[195]  = 0x834DF537B08E3450n;
    this.table[196]  = 0xFA209DA84220728Dn; this.table[197]  = 0x9E691D9B9EFE23F7n; this.table[198]  = 0x0446D288C4AE8D7Fn; this.table[199]  = 0x7B4CC524E169785Bn;
    this.table[200]  = 0x21D87F0135CA1385n; this.table[201]  = 0xCEBB400F137B8AA5n; this.table[202]  = 0x272E2B66580796BEn; this.table[203]  = 0x3612264125C2B0DEn;
    this.table[204]  = 0x057702BDAD1EFBB2n; this.table[205]  = 0xD4BABB8EACF84BE9n; this.table[206]  = 0x91583139641BC67Bn; this.table[207]  = 0x8BDC2DE08036E024n;
    this.table[208]  = 0x603C8156F49F68EDn; this.table[209]  = 0xF7D236F7DBEF5111n; this.table[210]  = 0x9727C4598AD21E80n; this.table[211]  = 0xA08A0896670A5FD7n;
    this.table[212]  = 0xCB4A8F4309EBA9CBn; this.table[213]  = 0x81AF564B0F7036A1n; this.table[214]  = 0xC0B99AA778199ABDn; this.table[215]  = 0x959F1EC83FC8E952n;
    this.table[216]  = 0x8C505077794A81B9n; this.table[217]  = 0x3ACAAF8F056338F0n; this.table[218]  = 0x07B43F50627A6778n; this.table[219]  = 0x4A44AB49F5ECCC77n;
    this.table[220]  = 0x3BC3D6E4B679EE98n; this.table[221]  = 0x9CC0D4D1CF14108Cn; this.table[222]  = 0x4406C00B206BC8A0n; this.table[223]  = 0x82A18854C8D72D89n;
    this.table[224]  = 0x67E366B35C3C432Cn; this.table[225]  = 0xB923DD61102B37F2n; this.table[226]  = 0x56AB2779D884271Dn; this.table[227]  = 0xBE83E1B0FF1525AFn;
    this.table[228]  = 0xFB7C65D4217E49A9n; this.table[229]  = 0x6BDBE0E76D48E7D4n; this.table[230]  = 0x08DF828745D9179En; this.table[231]  = 0x22EA6A9ADD53BD34n;
    this.table[232]  = 0xE36E141C5622200An; this.table[233]  = 0x7F805D1B8CB750EEn; this.table[234]  = 0xAFE5C7A59F58E837n; this.table[235]  = 0xE27F996A4FB1C23Cn;
    this.table[236]  = 0xD3867DFB0775F0D0n; this.table[237]  = 0xD0E673DE6E88891An; this.table[238]  = 0x123AEB9EAFB86C25n; this.table[239]  = 0x30F1D5D5C145B895n;
    this.table[240]  = 0xBB434A2DEE7269E7n; this.table[241]  = 0x78CB67ECF931FA38n; this.table[242]  = 0xF33B0372323BBF9Cn; this.table[243]  = 0x52D66336FB279C74n;
    this.table[244]  = 0x505F33AC0AFB4EAAn; this.table[245]  = 0xE8A5CD99A2CCE187n; this.table[246]  = 0x534974801E2D30BBn; this.table[247]  = 0x8D2D5711D5876D90n;
    this.table[248]  = 0x1F1A412891BC038En; this.table[249]  = 0xD6E2E71D82E56648n; this.table[250]  = 0x74036C3A497732B7n; this.table[251]  = 0x89B67ED96361F5ABn;
    this.table[252]  = 0xFFED95D8F1EA02A2n; this.table[253]  = 0xE72B3BD61464D43Dn; this.table[254]  = 0xA6300F170BDC4820n; this.table[255]  = 0xEBC18760ED78A77An;
    this.table[256]  = 0xE6A6BE5A05A12138n; this.table[257]  = 0xB5A122A5B4F87C98n; this.table[258]  = 0x563C6089140B6990n; this.table[259]  = 0x4C46CB2E391F5DD5n;
    this.table[260]  = 0xD932ADDBC9B79434n; this.table[261]  = 0x08EA70E42015AFF5n; this.table[262]  = 0xD765A6673E478CF1n; this.table[263]  = 0xC4FB757EAB278D99n;
    this.table[264]  = 0xDF11C6862D6E0692n; this.table[265]  = 0xDDEB84F10D7F3B16n; this.table[266]  = 0x6F2EF604A665EA04n; this.table[267]  = 0x4A8E0F0FF0E0DFB3n;
    this.table[268]  = 0xA5EDEEF83DBCBA51n; this.table[269]  = 0xFC4F0A2A0EA4371En; this.table[270]  = 0xE83E1DA85CB38429n; this.table[271]  = 0xDC8FF882BA1B1CE2n;
    this.table[272]  = 0xCD45505E8353E80Dn; this.table[273]  = 0x18D19A00D4DB0717n; this.table[274]  = 0x34A0CFEDA5F38101n; this.table[275]  = 0x0BE77E518887CAF2n;
    this.table[276]  = 0x1E341438B3C45136n; this.table[277]  = 0xE05797F49089CCF9n; this.table[278]  = 0xFFD23F9DF2591D14n; this.table[279]  = 0x543DDA228595C5CDn;
    this.table[280]  = 0x661F81FD99052A33n; this.table[281]  = 0x8736E641DB0F7B76n; this.table[282]  = 0x15227725418E5307n; this.table[283]  = 0xE25F7F46162EB2FAn;
    this.table[284]  = 0x48A8B2126C13D9FEn; this.table[285]  = 0xAFDC541792E76EEAn; this.table[286]  = 0x03D912BFC6D1898Fn; this.table[287]  = 0x31B1AAFA1B83F51Bn;
    this.table[288]  = 0xF1AC2796E42AB7D9n; this.table[289]  = 0x40A3A7D7FCD2EBACn; this.table[290]  = 0x1056136D0AFBBCC5n; this.table[291]  = 0x7889E1DD9A6D0C85n;
    this.table[292]  = 0xD33525782A7974AAn; this.table[293]  = 0xA7E25D09078AC09Bn; this.table[294]  = 0xBD4138B3EAC6EDD0n; this.table[295]  = 0x920ABFBE71EB9E70n;
    this.table[296]  = 0xA2A5D0F54FC2625Cn; this.table[297]  = 0xC054E36B0B1290A3n; this.table[298]  = 0xF6DD59FF62FE932Bn; this.table[299]  = 0x3537354511A8AC7Dn;
    this.table[300]  = 0xCA845E9172FADCD4n; this.table[301]  = 0x84F82B60329D20DCn; this.table[302]  = 0x79C62CE1CD672F18n; this.table[303]  = 0x8B09A2ADD124642Cn;
    this.table[304]  = 0xD0C1E96A19D9E726n; this.table[305]  = 0x5A786A9B4BA9500Cn; this.table[306]  = 0x0E020336634C43F3n; this.table[307]  = 0xC17B474AEB66D822n;
    this.table[308]  = 0x6A731AE3EC9BAAC2n; this.table[309]  = 0x8226667AE0840258n; this.table[310]  = 0x67D4567691CAECA5n; this.table[311]  = 0x1D94155C4875ADB5n;
    this.table[312]  = 0x6D00FD985B813FDFn; this.table[313]  = 0x51286EFCB774CD06n; this.table[314]  = 0x5E8834471FA744AFn; this.table[315]  = 0xF72CA0AEE761AE2En;
    this.table[316]  = 0xBE40E4CDAEE8E09An; this.table[317]  = 0xE9970BBB5118F665n; this.table[318]  = 0x726E4BEB33DF1964n; this.table[319]  = 0x703B000729199762n;
    this.table[320]  = 0x4631D816F5EF30A7n; this.table[321]  = 0xB880B5B51504A6BEn; this.table[322]  = 0x641793C37ED84B6Cn; this.table[323]  = 0x7B21ED77F6E97D96n;
    this.table[324]  = 0x776306312EF96B73n; this.table[325]  = 0xAE528948E86FF3F4n; this.table[326]  = 0x53DBD7F286A3F8F8n; this.table[327]  = 0x16CADCE74CFC1063n;
    this.table[328]  = 0x005C19BDFA52C6DDn; this.table[329]  = 0x68868F5D64D46AD3n; this.table[330]  = 0x3A9D512CCF1E186An; this.table[331]  = 0x367E62C2385660AEn;
    this.table[332]  = 0xE359E7EA77DCB1D7n; this.table[333]  = 0x526C0773749ABE6En; this.table[334]  = 0x735AE5F9D09F734Bn; this.table[335]  = 0x493FC7CC8A558BA8n;
    this.table[336]  = 0xB0B9C1533041AB45n; this.table[337]  = 0x321958BA470A59BDn; this.table[338]  = 0x852DB00B5F46C393n; this.table[339]  = 0x91209B2BD336B0E5n;
    this.table[340]  = 0x6E604F7D659EF19Fn; this.table[341]  = 0xB99A8AE2782CCB24n; this.table[342]  = 0xCCF52AB6C814C4C7n; this.table[343]  = 0x4727D9AFBE11727Bn;
    this.table[344]  = 0x7E950D0C0121B34Dn; this.table[345]  = 0x756F435670AD471Fn; this.table[346]  = 0xF5ADD442615A6849n; this.table[347]  = 0x4E87E09980B9957An;
    this.table[348]  = 0x2ACFA1DF50AEE355n; this.table[349]  = 0xD898263AFD2FD556n; this.table[350]  = 0xC8F4924DD80C8FD6n; this.table[351]  = 0xCF99CA3D754A173An;
    this.table[352]  = 0xFE477BACAF91BF3Cn; this.table[353]  = 0xED5371F6D690C12Dn; this.table[354]  = 0x831A5C285E687094n; this.table[355]  = 0xC5D3C90A3708A0A4n;
    this.table[356]  = 0x0F7F903717D06580n; this.table[357]  = 0x19F9BB13B8FDF27Fn; this.table[358]  = 0xB1BD6F1B4D502843n; this.table[359]  = 0x1C761BA38FFF4012n;
    this.table[360]  = 0x0D1530C4E2E21F3Bn; this.table[361]  = 0x8943CE69A7372C8An; this.table[362]  = 0xE5184E11FEB5CE66n; this.table[363]  = 0x618BDB80BD736621n;
    this.table[364]  = 0x7D29BAD68B574D0Bn; this.table[365]  = 0x81BB613E25E6FE5Bn; this.table[366]  = 0x071C9C10BC07913Fn; this.table[367]  = 0xC7BEEB7909AC2D97n;
    this.table[368]  = 0xC3E58D353BC5D757n; this.table[369]  = 0xEB017892F38F61E8n; this.table[370]  = 0xD4EFFB9C9B1CC21An; this.table[371]  = 0x99727D26F494F7ABn;
    this.table[372]  = 0xA3E063A2956B3E03n; this.table[373]  = 0x9D4A8B9A4AA09C30n; this.table[374]  = 0x3F6AB7D500090FB4n; this.table[375]  = 0x9CC0F2A057268AC0n;
    this.table[376]  = 0x3DEE9D2DEDBF42D1n; this.table[377]  = 0x330F49C87960A972n; this.table[378]  = 0xC6B2720287421B41n; this.table[379]  = 0x0AC59EC07C00369Cn;
    this.table[380]  = 0xEF4EAC49CB353425n; this.table[381]  = 0xF450244EEF0129D8n; this.table[382]  = 0x8ACC46E5CAF4DEB6n; this.table[383]  = 0x2FFEAB63989263F7n;
    this.table[384]  = 0x8F7CB9FE5D7A4578n; this.table[385]  = 0x5BD8F7644E634635n; this.table[386]  = 0x427A7315BF2DC900n; this.table[387]  = 0x17D0C4AA2125261Cn;
    this.table[388]  = 0x3992486C93518E50n; this.table[389]  = 0xB4CBFEE0A2D7D4C3n; this.table[390]  = 0x7C75D6202C5DDD8Dn; this.table[391]  = 0xDBC295D8E35B6C61n;
    this.table[392]  = 0x60B369D302032B19n; this.table[393]  = 0xCE42685FDCE44132n; this.table[394]  = 0x06F3DDB9DDF65610n; this.table[395]  = 0x8EA4D21DB5E148F0n;
    this.table[396]  = 0x20B0FCE62FCD496Fn; this.table[397]  = 0x2C1B912358B0EE31n; this.table[398]  = 0xB28317B818F5A308n; this.table[399]  = 0xA89C1E189CA6D2CFn;
    this.table[400]  = 0x0C6B18576AAADBC8n; this.table[401]  = 0xB65DEAA91299FAE3n; this.table[402]  = 0xFB2B794B7F1027E7n; this.table[403]  = 0x04E4317F443B5BEBn;
    this.table[404]  = 0x4B852D325939D0A6n; this.table[405]  = 0xD5AE6BEEFB207FFCn; this.table[406]  = 0x309682B281C7D374n; this.table[407]  = 0xBAE309A194C3B475n;
    this.table[408]  = 0x8CC3F97B13B49F05n; this.table[409]  = 0x98A9422FF8293967n; this.table[410]  = 0x244B16B01076FF7Cn; this.table[411]  = 0xF8BF571C663D67EEn;
    this.table[412]  = 0x1F0D6758EEE30DA1n; this.table[413]  = 0xC9B611D97ADEB9B7n; this.table[414]  = 0xB7AFD5887B6C57A2n; this.table[415]  = 0x6290AE846B984FE1n;
    this.table[416]  = 0x94DF4CDEACC1A5FDn; this.table[417]  = 0x058A5BD1C5483AFFn; this.table[418]  = 0x63166CC142BA3C37n; this.table[419]  = 0x8DB8526EB2F76F40n;
    this.table[420]  = 0xE10880036F0D6D4En; this.table[421]  = 0x9E0523C9971D311Dn; this.table[422]  = 0x45EC2824CC7CD691n; this.table[423]  = 0x575B8359E62382C9n;
    this.table[424]  = 0xFA9E400DC4889995n; this.table[425]  = 0xD1823ECB45721568n; this.table[426]  = 0xDAFD983B8206082Fn; this.table[427]  = 0xAA7D29082386A8CBn;
    this.table[428]  = 0x269FCD4403B87588n; this.table[429]  = 0x1B91F5F728BDD1E0n; this.table[430]  = 0xE4669F39040201F6n; this.table[431]  = 0x7A1D7C218CF04ADEn;
    this.table[432]  = 0x65623C29D79CE5CEn; this.table[433]  = 0x2368449096C00BB1n; this.table[434]  = 0xAB9BF1879DA503BAn; this.table[435]  = 0xBC23ECB1A458058En;
    this.table[436]  = 0x9A58DF01BB401ECCn; this.table[437]  = 0xA070E868A85F143Dn; this.table[438]  = 0x4FF188307DF2239En; this.table[439]  = 0x14D565B41A641183n;
    this.table[440]  = 0xEE13337452701602n; this.table[441]  = 0x950E3DCF3F285E09n; this.table[442]  = 0x59930254B9C80953n; this.table[443]  = 0x3BF299408930DA6Dn;
    this.table[444]  = 0xA955943F53691387n; this.table[445]  = 0xA15EDECAA9CB8784n; this.table[446]  = 0x29142127352BE9A0n; this.table[447]  = 0x76F0371FFF4E7AFBn;
    this.table[448]  = 0x0239F450274F2228n; this.table[449]  = 0xBB073AF01D5E868Bn; this.table[450]  = 0xBFC80571C10E96C1n; this.table[451]  = 0xD267088568222E23n;
    this.table[452]  = 0x9671A3D48E80B5B0n; this.table[453]  = 0x55B5D38AE193BB81n; this.table[454]  = 0x693AE2D0A18B04B8n; this.table[455]  = 0x5C48B4ECADD5335Fn;
    this.table[456]  = 0xFD743B194916A1CAn; this.table[457]  = 0x2577018134BE98C4n; this.table[458]  = 0xE77987E83C54A4ADn; this.table[459]  = 0x28E11014DA33E1B9n;
    this.table[460]  = 0x270CC59E226AA213n; this.table[461]  = 0x71495F756D1A5F60n; this.table[462]  = 0x9BE853FB60AFEF77n; this.table[463]  = 0xADC786A7F7443DBFn;
    this.table[464]  = 0x0904456173B29A82n; this.table[465]  = 0x58BC7A66C232BD5En; this.table[466]  = 0xF306558C673AC8B2n; this.table[467]  = 0x41F639C6B6C9772An;
    this.table[468]  = 0x216DEFE99FDA35DAn; this.table[469]  = 0x11640CC71C7BE615n; this.table[470]  = 0x93C43694565C5527n; this.table[471]  = 0xEA038E6246777839n;
    this.table[472]  = 0xF9ABF3CE5A3E2469n; this.table[473]  = 0x741E768D0FD312D2n; this.table[474]  = 0x0144B883CED652C6n; this.table[475]  = 0xC20B5A5BA33F8552n;
    this.table[476]  = 0x1AE69633C3435A9Dn; this.table[477]  = 0x97A28CA4088CFDECn; this.table[478]  = 0x8824A43C1E96F420n; this.table[479]  = 0x37612FA66EEEA746n;
    this.table[480]  = 0x6B4CB165F9CF0E5An; this.table[481]  = 0x43AA1C06A0ABFB4An; this.table[482]  = 0x7F4DC26FF162796Bn; this.table[483]  = 0x6CBACC8E54ED9B0Fn;
    this.table[484]  = 0xA6B7FFEFD2BB253En; this.table[485]  = 0x2E25BC95B0A29D4Fn; this.table[486]  = 0x86D6A58BDEF1388Cn; this.table[487]  = 0xDED74AC576B6F054n;
    this.table[488]  = 0x8030BDBC2B45805Dn; this.table[489]  = 0x3C81AF70E94D9289n; this.table[490]  = 0x3EFF6DDA9E3100DBn; this.table[491]  = 0xB38DC39FDFCC8847n;
    this.table[492]  = 0x123885528D17B87En; this.table[493]  = 0xF2DA0ED240B1B642n; this.table[494]  = 0x44CEFADCD54BF9A9n; this.table[495]  = 0x1312200E433C7EE6n;
    this.table[496]  = 0x9FFCC84F3A78C748n; this.table[497]  = 0xF0CD1F72248576BBn; this.table[498]  = 0xEC6974053638CFE4n; this.table[499]  = 0x2BA7B67C0CEC4E4Cn;
    this.table[500]  = 0xAC2F4DF3E5CE32EDn; this.table[501]  = 0xCB33D14326EA4C11n; this.table[502]  = 0xA4E9044CC77E58BCn; this.table[503]  = 0x5F513293D934FCEFn;
    this.table[504]  = 0x5DC9645506E55444n; this.table[505]  = 0x50DE418F317DE40An; this.table[506]  = 0x388CB31A69DDE259n; this.table[507]  = 0x2DB4A83455820A86n;
    this.table[508]  = 0x9010A91E84711AE9n; this.table[509]  = 0x4DF7F0B7B1498371n; this.table[510]  = 0xD62A2EABC0977179n; this.table[511]  = 0x22FAC097AA8D5C0En;
    this.table[512]  = 0xF49FCC2FF1DAF39Bn; this.table[513]  = 0x487FD5C66FF29281n; this.table[514]  = 0xE8A30667FCDCA83Fn; this.table[515]  = 0x2C9B4BE3D2FCCE63n;
    this.table[516]  = 0xDA3FF74B93FBBBC2n; this.table[517]  = 0x2FA165D2FE70BA66n; this.table[518]  = 0xA103E279970E93D4n; this.table[519]  = 0xBECDEC77B0E45E71n;
    this.table[520]  = 0xCFB41E723985E497n; this.table[521]  = 0xB70AAA025EF75017n; this.table[522]  = 0xD42309F03840B8E0n; this.table[523]  = 0x8EFC1AD035898579n;
    this.table[524]  = 0x96C6920BE2B2ABC5n; this.table[525]  = 0x66AF4163375A9172n; this.table[526]  = 0x2174ABDCCA7127FBn; this.table[527]  = 0xB33CCEA64A72FF41n;
    this.table[528]  = 0xF04A4933083066A5n; this.table[529]  = 0x8D970ACDD7289AF5n; this.table[530]  = 0x8F96E8E031C8C25En; this.table[531]  = 0xF3FEC02276875D47n;
    this.table[532]  = 0xEC7BF310056190DDn; this.table[533]  = 0xF5ADB0AEBB0F1491n; this.table[534]  = 0x9B50F8850FD58892n; this.table[535]  = 0x4975488358B74DE8n;
    this.table[536]  = 0xA3354FF691531C61n; this.table[537]  = 0x0702BBE481D2C6EEn; this.table[538]  = 0x89FB24057DEDED98n; this.table[539]  = 0xAC3075138596E902n;
    this.table[540]  = 0x1D2D3580172772EDn; this.table[541]  = 0xEB738FC28E6BC30Dn; this.table[542]  = 0x5854EF8F63044326n; this.table[543]  = 0x9E5C52325ADD3BBEn;
    this.table[544]  = 0x90AA53CF325C4623n; this.table[545]  = 0xC1D24D51349DD067n; this.table[546]  = 0x2051CFEEA69EA624n; this.table[547]  = 0x13220F0A862E7E4Fn;
    this.table[548]  = 0xCE39399404E04864n; this.table[549]  = 0xD9C42CA47086FCB7n; this.table[550]  = 0x685AD2238A03E7CCn; this.table[551]  = 0x066484B2AB2FF1DBn;
    this.table[552]  = 0xFE9D5D70EFBF79ECn; this.table[553]  = 0x5B13B9DD9C481854n; this.table[554]  = 0x15F0D475ED1509ADn; this.table[555]  = 0x0BEBCD060EC79851n;
    this.table[556]  = 0xD58C6791183AB7F8n; this.table[557]  = 0xD1187C5052F3EEE4n; this.table[558]  = 0xC95D1192E54E82FFn; this.table[559]  = 0x86EEA14CB9AC6CA2n;
    this.table[560]  = 0x3485BEB153677D5Dn; this.table[561]  = 0xDD191D781F8C492An; this.table[562]  = 0xF60866BAA784EBF9n; this.table[563]  = 0x518F643BA2D08C74n;
    this.table[564]  = 0x8852E956E1087C22n; this.table[565]  = 0xA768CB8DC410AE8Dn; this.table[566]  = 0x38047726BFEC8E1An; this.table[567]  = 0xA67738B4CD3B45AAn;
    this.table[568]  = 0xAD16691CEC0DDE19n; this.table[569]  = 0xC6D4319380462E07n; this.table[570]  = 0xC5A5876D0BA61938n; this.table[571]  = 0x16B9FA1FA58FD840n;
    this.table[572]  = 0x188AB1173CA74F18n; this.table[573]  = 0xABDA2F98C99C021Fn; this.table[574]  = 0x3E0580AB134AE816n; this.table[575]  = 0x5F3B05B773645ABBn;
    this.table[576]  = 0x2501A2BE5575F2F6n; this.table[577]  = 0x1B2F74004E7E8BA9n; this.table[578]  = 0x1CD7580371E8D953n; this.table[579]  = 0x7F6ED89562764E30n;
    this.table[580]  = 0xB15926FF596F003Dn; this.table[581]  = 0x9F65293DA8C5D6B9n; this.table[582]  = 0x6ECEF04DD690F84Cn; this.table[583]  = 0x4782275FFF33AF88n;
    this.table[584]  = 0xE41433083F820801n; this.table[585]  = 0xFD0DFE409A1AF9B5n; this.table[586]  = 0x4325A3342CDB396Bn; this.table[587]  = 0x8AE77E62B301B252n;
    this.table[588]  = 0xC36F9E9F6655615An; this.table[589]  = 0x85455A2D92D32C09n; this.table[590]  = 0xF2C7DEA949477485n; this.table[591]  = 0x63CFB4C133A39EBAn;
    this.table[592]  = 0x83B040CC6EBC5462n; this.table[593]  = 0x3B9454C8FDB326B0n; this.table[594]  = 0x56F56A9E87FFD78Cn; this.table[595]  = 0x2DC2940D99F42BC6n;
    this.table[596]  = 0x98F7DF096B096E2Dn; this.table[597]  = 0x19A6E01E3AD852BFn; this.table[598]  = 0x42A99CCBDBD4B40Bn; this.table[599]  = 0xA59998AF45E9C559n;
    this.table[600]  = 0x366295E807D93186n; this.table[601]  = 0x6B48181BFAA1F773n; this.table[602]  = 0x1FEC57E2157A0A1Dn; this.table[603]  = 0x4667446AF6201AD5n;
    this.table[604]  = 0xE615EBCACFB0F075n; this.table[605]  = 0xB8F31F4F68290778n; this.table[606]  = 0x22713ED6CE22D11En; this.table[607]  = 0x3057C1A72EC3C93Bn;
    this.table[608]  = 0xCB46ACC37C3F1F2Fn; this.table[609]  = 0xDBB893FD02AAF50En; this.table[610]  = 0x331FD92E600B9FCFn; this.table[611]  = 0xA498F96148EA3AD6n;
    this.table[612]  = 0xA8D8426E8B6A83EAn; this.table[613]  = 0xA089B274B7735CDCn; this.table[614]  = 0x87F6B3731E524A11n; this.table[615]  = 0x118808E5CBC96749n;
    this.table[616]  = 0x9906E4C7B19BD394n; this.table[617]  = 0xAFED7F7E9B24A20Cn; this.table[618]  = 0x6509EADEEB3644A7n; this.table[619]  = 0x6C1EF1D3E8EF0EDEn;
    this.table[620]  = 0xB9C97D43E9798FB4n; this.table[621]  = 0xA2F2D784740C28A3n; this.table[622]  = 0x7B8496476197566Fn; this.table[623]  = 0x7A5BE3E6B65F069Dn;
    this.table[624]  = 0xF96330ED78BE6F10n; this.table[625]  = 0xEEE60DE77A076A15n; this.table[626]  = 0x2B4BEE4AA08B9BD0n; this.table[627]  = 0x6A56A63EC7B8894En;
    this.table[628]  = 0x02121359BA34FEF4n; this.table[629]  = 0x4CBF99F8283703FCn; this.table[630]  = 0x398071350CAF30C8n; this.table[631]  = 0xD0A77A89F017687An;
    this.table[632]  = 0xF1C1A9EB9E423569n; this.table[633]  = 0x8C7976282DEE8199n; this.table[634]  = 0x5D1737A5DD1F7ABDn; this.table[635]  = 0x4F53433C09A9FA80n;
    this.table[636]  = 0xFA8B0C53DF7CA1D9n; this.table[637]  = 0x3FD9DCBC886CCB77n; this.table[638]  = 0xC040917CA91B4720n; this.table[639]  = 0x7DD00142F9D1DCDFn;
    this.table[640]  = 0x8476FC1D4F387B58n; this.table[641]  = 0x23F8E7C5F3316503n; this.table[642]  = 0x032A2244E7E37339n; this.table[643]  = 0x5C87A5D750F5A74Bn;
    this.table[644]  = 0x082B4CC43698992En; this.table[645]  = 0xDF917BECB858F63Cn; this.table[646]  = 0x3270B8FC5BF86DDAn; this.table[647]  = 0x10AE72BB29B5DD76n;
    this.table[648]  = 0x576AC94E7700362Bn; this.table[649]  = 0x1AD112DAC61EFB8Fn; this.table[650]  = 0x691BC30EC5FAA427n; this.table[651]  = 0xFF246311CC327143n;
    this.table[652]  = 0x3142368E30E53206n; this.table[653]  = 0x71380E31E02CA396n; this.table[654]  = 0x958D5C960AAD76F1n; this.table[655]  = 0xF8D6F430C16DA536n;
    this.table[656]  = 0xC8FFD13F1BE7E1D2n; this.table[657]  = 0x7578AE66004DDBE1n; this.table[658]  = 0x05833F01067BE646n; this.table[659]  = 0xBB34B5AD3BFE586Dn;
    this.table[660]  = 0x095F34C9A12B97F0n; this.table[661]  = 0x247AB64525D60CA8n; this.table[662]  = 0xDCDBC6F3017477D1n; this.table[663]  = 0x4A2E14D4DECAD24Dn;
    this.table[664]  = 0xBDB5E6D9BE0A1EEBn; this.table[665]  = 0x2A7E70F7794301ABn; this.table[666]  = 0xDEF42D8A270540FDn; this.table[667]  = 0x01078EC0A34C22C1n;
    this.table[668]  = 0xE5DE511AF4C16387n; this.table[669]  = 0x7EBB3A52BD9A330An; this.table[670]  = 0x77697857AA7D6435n; this.table[671]  = 0x004E831603AE4C32n;
    this.table[672]  = 0xE7A21020AD78E312n; this.table[673]  = 0x9D41A70C6AB420F2n; this.table[674]  = 0x28E06C18EA1141E6n; this.table[675]  = 0xD2B28CBD984F6B28n;
    this.table[676]  = 0x26B75F6C446E9D83n; this.table[677]  = 0xBA47568C4D418D7Fn; this.table[678]  = 0xD80BADBFE6183D8En; this.table[679]  = 0x0E206D7F5F166044n;
    this.table[680]  = 0xE258A43911CBCA3En; this.table[681]  = 0x723A1746B21DC0BCn; this.table[682]  = 0xC7CAA854F5D7CDD3n; this.table[683]  = 0x7CAC32883D261D9Cn;
    this.table[684]  = 0x7690C26423BA942Cn; this.table[685]  = 0x17E55524478042B8n; this.table[686]  = 0xE0BE477656A2389Fn; this.table[687]  = 0x4D289B5E67AB2DA0n;
    this.table[688]  = 0x44862B9C8FBBFD31n; this.table[689]  = 0xB47CC8049D141365n; this.table[690]  = 0x822C1B362B91C793n; this.table[691]  = 0x4EB14655FB13DFD8n;
    this.table[692]  = 0x1ECBBA0714E2A97Bn; this.table[693]  = 0x6143459D5CDE5F14n; this.table[694]  = 0x53A8FBF1D5F0AC89n; this.table[695]  = 0x97EA04D81C5E5B00n;
    this.table[696]  = 0x622181A8D4FDB3F3n; this.table[697]  = 0xE9BCD341572A1208n; this.table[698]  = 0x1411258643CCE58An; this.table[699]  = 0x9144C5FEA4C6E0A4n;
    this.table[700]  = 0x0D33D06565CF620Fn; this.table[701]  = 0x54A48D489F219CA1n; this.table[702]  = 0xC43E5EAC6D63C821n; this.table[703]  = 0xA9728B3A72770DAFn;
    this.table[704]  = 0xD7934E7B20DF87EFn; this.table[705]  = 0xE35503B61A3E86E5n; this.table[706]  = 0xCAE321FBC819D504n; this.table[707]  = 0x129A50B3AC60BFA6n;
    this.table[708]  = 0xCD5E68EA7E9FB6C3n; this.table[709]  = 0xB01C90199483B1C7n; this.table[710]  = 0x3DE93CD5C295376Cn; this.table[711]  = 0xAED52EDF2AB9AD13n;
    this.table[712]  = 0x2E60F512C0A07884n; this.table[713]  = 0xBC3D86A3E36210C9n; this.table[714]  = 0x35269D9B163951CEn; this.table[715]  = 0x0C7D6E2AD0CDB5FAn;
    this.table[716]  = 0x59E86297D87F5733n; this.table[717]  = 0x298EF221898DB0E7n; this.table[718]  = 0x55000029D1A5AA7En; this.table[719]  = 0x8BC08AE1B5061B45n;
    this.table[720]  = 0xC2C31C2B6C92703An; this.table[721]  = 0x94CC596BAF25EF42n; this.table[722]  = 0x0A1D73DB22540456n; this.table[723]  = 0x04B6A0F9D9C4179An;
    this.table[724]  = 0xEFFDAFA2AE3D3C60n; this.table[725]  = 0xF7C8075BB49496C4n; this.table[726]  = 0x9CC5C7141D1CD4E3n; this.table[727]  = 0x78BD1638218E5534n;
    this.table[728]  = 0xB2F11568F850246An; this.table[729]  = 0xEDFABCFA9502BC29n; this.table[730]  = 0x796CE5F2DA23051Bn; this.table[731]  = 0xAAE128B0DC93537Cn;
    this.table[732]  = 0x3A493DA0EE4B29AEn; this.table[733]  = 0xB5DF6B2C416895D7n; this.table[734]  = 0xFCABBD25122D7F37n; this.table[735]  = 0x70810B58105DC4B1n;
    this.table[736]  = 0xE10FDD37F7882A90n; this.table[737]  = 0x524DCAB5518A3F5Cn; this.table[738]  = 0x3C9E85878451255Bn; this.table[739]  = 0x4029828119BD34E2n;
    this.table[740]  = 0x74A05B6F5D3CECCBn; this.table[741]  = 0xB610021542E13ECAn; this.table[742]  = 0x0FF979D12F59E2ACn; this.table[743]  = 0x6037DA27E4F9CC50n;
    this.table[744]  = 0x5E92975A0DF1847Dn; this.table[745]  = 0xD66DE190D3E623FEn; this.table[746]  = 0x5032D6B87B568048n; this.table[747]  = 0x9A36B7CE8235216En;
    this.table[748]  = 0x80272A7A24F64B4An; this.table[749]  = 0x93EFED8B8C6916F7n; this.table[750]  = 0x37DDBFF44CCE1555n; this.table[751]  = 0x4B95DB5D4B99BD25n;
    this.table[752]  = 0x92D3FDA169812FC0n; this.table[753]  = 0xFB1A4A9A90660BB6n; this.table[754]  = 0x730C196946A4B9B2n; this.table[755]  = 0x81E289AA7F49DA68n;
    this.table[756]  = 0x64669A0F83B1A05Fn; this.table[757]  = 0x27B3FF7D9644F48Bn; this.table[758]  = 0xCC6B615C8DB675B3n; this.table[759]  = 0x674F20B9BCEBBE95n;
    this.table[760]  = 0x6F31238275655982n; this.table[761]  = 0x5AE488713E45CF05n; this.table[762]  = 0xBF619F9954C21157n; this.table[763]  = 0xEABAC46040A8EAE9n;
    this.table[764]  = 0x454C6FE9F2C0C1CDn; this.table[765]  = 0x419CF6496412691Cn; this.table[766]  = 0xD3DC3BEF265B0F70n; this.table[767]  = 0x6D0E60F5C3578A9En;
    this.table[768]  = 0x5B0E608526323C55n; this.table[769]  = 0x1A46C1A9FA1B59F5n; this.table[770]  = 0xA9E245A17C4C8FFAn; this.table[771]  = 0x65CA5159DB2955D7n;
    this.table[772]  = 0x05DB0A76CE35AFC2n; this.table[773]  = 0x81EAC77EA9113D45n; this.table[774]  = 0x528EF88AB6AC0A0Dn; this.table[775]  = 0xA09EA253597BE3FFn;
    this.table[776]  = 0x430DDFB3AC48CD56n; this.table[777]  = 0xC4B3A67AF45CE46Fn; this.table[778]  = 0x4ECECFD8FBE2D05En; this.table[779]  = 0x3EF56F10B39935F0n;
    this.table[780]  = 0x0B22D6829CD619C6n; this.table[781]  = 0x17FD460A74DF2069n; this.table[782]  = 0x6CF8CC8E8510ED40n; this.table[783]  = 0xD6C824BF3A6ECAA7n;
    this.table[784]  = 0x61243D581A817049n; this.table[785]  = 0x048BACB6BBC163A2n; this.table[786]  = 0xD9A38AC27D44CC32n; this.table[787]  = 0x7FDDFF5BAAF410ABn;
    this.table[788]  = 0xAD6D495AA804824Bn; this.table[789]  = 0xE1A6A74F2D8C9F94n; this.table[790]  = 0xD4F7851235DEE8E3n; this.table[791]  = 0xFD4B7F886540D893n;
    this.table[792]  = 0x247C20042AA4BFDAn; this.table[793]  = 0x096EA1C517D1327Cn; this.table[794]  = 0xD56966B4361A6685n; this.table[795]  = 0x277DA5C31221057Dn;
    this.table[796]  = 0x94D59893A43ACFF7n; this.table[797]  = 0x64F0C51CCDC02281n; this.table[798]  = 0x3D33BCC4FF6189DBn; this.table[799]  = 0xE005CB184CE66AF1n;
    this.table[800]  = 0xFF5CCD1D1DB99BEAn; this.table[801]  = 0xB0B854A7FE42980Fn; this.table[802]  = 0x7BD46A6A718D4B9Fn; this.table[803]  = 0xD10FA8CC22A5FD8Cn;
    this.table[804]  = 0xD31484952BE4BD31n; this.table[805]  = 0xC7FA975FCB243847n; this.table[806]  = 0x4886ED1E5846C407n; this.table[807]  = 0x28CDDB791EB70B04n;
    this.table[808]  = 0xC2B00BE2F573417Fn; this.table[809]  = 0x5C9590452180F877n; this.table[810]  = 0x7A6BDDFFF370EB00n; this.table[811]  = 0xCE509E38D6D9D6A4n;
    this.table[812]  = 0xEBEB0F00647FA702n; this.table[813]  = 0x1DCC06CF76606F06n; this.table[814]  = 0xE4D9F28BA286FF0An; this.table[815]  = 0xD85A305DC918C262n;
    this.table[816]  = 0x475B1D8732225F54n; this.table[817]  = 0x2D4FB51668CCB5FEn; this.table[818]  = 0xA679B9D9D72BBA20n; this.table[819]  = 0x53841C0D912D43A5n;
    this.table[820]  = 0x3B7EAA48BF12A4E8n; this.table[821]  = 0x781E0E47F22F1DDFn; this.table[822]  = 0xEFF20CE60AB50973n; this.table[823]  = 0x20D261D19DFFB742n;
    this.table[824]  = 0x16A12B03062A2E39n; this.table[825]  = 0x1960EB2239650495n; this.table[826]  = 0x251C16FED50EB8B8n; this.table[827]  = 0x9AC0C330F826016En;
    this.table[828]  = 0xED152665953E7671n; this.table[829]  = 0x02D63194A6369570n; this.table[830]  = 0x5074F08394B1C987n; this.table[831]  = 0x70BA598C90B25CE1n;
    this.table[832]  = 0x794A15810B9742F6n; this.table[833]  = 0x0D5925E9FCAF8C6Cn; this.table[834]  = 0x3067716CD868744En; this.table[835]  = 0x910AB077E8D7731Bn;
    this.table[836]  = 0x6A61BBDB5AC42F61n; this.table[837]  = 0x93513EFBF0851567n; this.table[838]  = 0xF494724B9E83E9D5n; this.table[839]  = 0xE887E1985C09648Dn;
    this.table[840]  = 0x34B1D3C675370CFDn; this.table[841]  = 0xDC35E433BC0D255Dn; this.table[842]  = 0xD0AAB84234131BE0n; this.table[843]  = 0x08042A50B48B7EAFn;
    this.table[844]  = 0x9997C4EE44A3AB35n; this.table[845]  = 0x829A7B49201799D0n; this.table[846]  = 0x263B8307B7C54441n; this.table[847]  = 0x752F95F4FD6A6CA6n;
    this.table[848]  = 0x927217402C08C6E5n; this.table[849]  = 0x2A8AB754A795D9EEn; this.table[850]  = 0xA442F7552F72943Dn; this.table[851]  = 0x2C31334E19781208n;
    this.table[852]  = 0x4FA98D7CEAEE6291n; this.table[853]  = 0x55C3862F665DB309n; this.table[854]  = 0xBD0610175D53B1F3n; this.table[855]  = 0x46FE6CB840413F27n;
    this.table[856]  = 0x3FE03792DF0CFA59n; this.table[857]  = 0xCFE700372EB85E8Fn; this.table[858]  = 0xA7BE29E7ADBCE118n; this.table[859]  = 0xE544EE5CDE8431DDn;
    this.table[860]  = 0x8A781B1B41F1873En; this.table[861]  = 0xA5C94C78A0D2F0E7n; this.table[862]  = 0x39412E2877B60728n; this.table[863]  = 0xA1265EF3AFC9A62Cn;
    this.table[864]  = 0xBCC2770C6A2506C5n; this.table[865]  = 0x3AB66DD5DCE1CE12n; this.table[866]  = 0xE65499D04A675B37n; this.table[867]  = 0x7D8F523481BFD216n;
    this.table[868]  = 0x0F6F64FCEC15F389n; this.table[869]  = 0x74EFBE618B5B13C8n; this.table[870]  = 0xACDC82B714273E1Dn; this.table[871]  = 0xDD40BFE003199D17n;
    this.table[872]  = 0x37E99257E7E061F8n; this.table[873]  = 0xFA52626904775AAAn; this.table[874]  = 0x8BBBF63A463D56F9n; this.table[875]  = 0xF0013F1543A26E64n;
    this.table[876]  = 0xA8307E9F879EC898n; this.table[877]  = 0xCC4C27A4150177CCn; this.table[878]  = 0x1B432F2CCA1D3348n; this.table[879]  = 0xDE1D1F8F9F6FA013n;
    this.table[880]  = 0x606602A047A7DDD6n; this.table[881]  = 0xD237AB64CC1CB2C7n; this.table[882]  = 0x9B938E7225FCD1D3n; this.table[883]  = 0xEC4E03708E0FF476n;
    this.table[884]  = 0xFEB2FBDA3D03C12Dn; this.table[885]  = 0xAE0BCED2EE43889An; this.table[886]  = 0x22CB8923EBFB4F43n; this.table[887]  = 0x69360D013CF7396Dn;
    this.table[888]  = 0x855E3602D2D4E022n; this.table[889]  = 0x073805BAD01F784Cn; this.table[890]  = 0x33E17A133852F546n; this.table[891]  = 0xDF4874058AC7B638n;
    this.table[892]  = 0xBA92B29C678AA14An; this.table[893]  = 0x0CE89FC76CFAADCDn; this.table[894]  = 0x5F9D4E0908339E34n; this.table[895]  = 0xF1AFE9291F5923B9n;
    this.table[896]  = 0x6E3480F60F4A265Fn; this.table[897]  = 0xEEBF3A2AB29B841Cn; this.table[898]  = 0xE21938A88F91B4ADn; this.table[899]  = 0x57DFEFF845C6D3C3n;
    this.table[900]  = 0x2F006B0BF62CAAF2n; this.table[901]  = 0x62F479EF6F75EE78n; this.table[902]  = 0x11A55AD41C8916A9n; this.table[903]  = 0xF229D29084FED453n;
    this.table[904]  = 0x42F1C27B16B000E6n; this.table[905]  = 0x2B1F76749823C074n; this.table[906]  = 0x4B76ECA3C2745360n; this.table[907]  = 0x8C98F463B91691BDn;
    this.table[908]  = 0x14BCC93CF1ADE66An; this.table[909]  = 0x8885213E6D458397n; this.table[910]  = 0x8E177DF0274D4711n; this.table[911]  = 0xB49B73B5503F2951n;
    this.table[912]  = 0x10168168C3F96B6Bn; this.table[913]  = 0x0E3D963B63CAB0AEn; this.table[914]  = 0x8DFC4B5655A1DB14n; this.table[915]  = 0xF789F1356E14DE5Cn;
    this.table[916]  = 0x683E68AF4E51DAC1n; this.table[917]  = 0xC9A84F9D8D4B0FD9n; this.table[918]  = 0x3691E03F52A0F9D1n; this.table[919]  = 0x5ED86E46E1878E80n;
    this.table[920]  = 0x3C711A0E99D07150n; this.table[921]  = 0x5A0865B20C4E9310n; this.table[922]  = 0x56FBFC1FE4F0682En; this.table[923]  = 0xEA8D5DE3105EDF9Bn;
    this.table[924]  = 0x71ABFDB12379187An; this.table[925]  = 0x2EB99DE1BEE77B9Cn; this.table[926]  = 0x21ECC0EA33CF4523n; this.table[927]  = 0x59A4D7521805C7A1n;
    this.table[928]  = 0x3896F5EB56AE7C72n; this.table[929]  = 0xAA638F3DB18F75DCn; this.table[930]  = 0x9F39358DABE9808En; this.table[931]  = 0xB7DEFA91C00B72ACn;
    this.table[932]  = 0x6B5541FD62492D92n; this.table[933]  = 0x6DC6DEE8F92E4D5Bn; this.table[934]  = 0x353F57ABC4BEEA7En; this.table[935]  = 0x735769D6DA5690CEn;
    this.table[936]  = 0x0A234AA642391484n; this.table[937]  = 0xF6F9508028F80D9Dn; this.table[938]  = 0xB8E319A27AB3F215n; this.table[939]  = 0x31AD9C1151341A4Dn;
    this.table[940]  = 0x773C22A57BEF5805n; this.table[941]  = 0x45C7561A07968633n; this.table[942]  = 0xF913DA9E249DBE36n; this.table[943]  = 0xDA652D9B78A64C68n;
    this.table[944]  = 0x4C27A97F3BC334EFn; this.table[945]  = 0x76621220E66B17F4n; this.table[946]  = 0x967743899ACD7D0Bn; this.table[947]  = 0xF3EE5BCAE0ED6782n;
    this.table[948]  = 0x409F753600C879FCn; this.table[949]  = 0x06D09A39B5926DB6n; this.table[950]  = 0x6F83AEB0317AC588n; this.table[951]  = 0x01E6CA4A86381F21n;
    this.table[952]  = 0x66FF3462D19F3025n; this.table[953]  = 0x72207C24DDFD3BFBn; this.table[954]  = 0x4AF6B6D3E2ECE2EBn; this.table[955]  = 0x9C994DBEC7EA08DEn;
    this.table[956]  = 0x49ACE597B09A8BC4n; this.table[957]  = 0xB38C4766CF0797BAn; this.table[958]  = 0x131B9373C57C2A75n; this.table[959]  = 0xB1822CCE61931E58n;
    this.table[960]  = 0x9D7555B909BA1C0Cn; this.table[961]  = 0x127FAFDD937D11D2n; this.table[962]  = 0x29DA3BADC66D92E4n; this.table[963]  = 0xA2C1D57154C2ECBCn;
    this.table[964]  = 0x58C5134D82F6FE24n; this.table[965]  = 0x1C3AE3515B62274Fn; this.table[966]  = 0xE907C82E01CB8126n; this.table[967]  = 0xF8ED091913E37FCBn;
    this.table[968]  = 0x3249D8F9C80046C9n; this.table[969]  = 0x80CF9BEDE388FB63n; this.table[970]  = 0x1881539A116CF19En; this.table[971]  = 0x5103F3F76BD52457n;
    this.table[972]  = 0x15B7E6F5AE47F7A8n; this.table[973]  = 0xDBD7C6DED47E9CCFn; this.table[974]  = 0x44E55C410228BB1An; this.table[975]  = 0xB647D4255EDB4E99n;
    this.table[976]  = 0x5D11882BB8AAFC30n; this.table[977]  = 0xF5098BBB29D3212An; this.table[978]  = 0x8FB5EA14E90296B3n; this.table[979]  = 0x677B942157DD025An;
    this.table[980]  = 0xFB58E7C0A390ACB5n; this.table[981]  = 0x89D3674C83BD4A01n; this.table[982]  = 0x9E2DA4DF4BF3B93Bn; this.table[983]  = 0xFCC41E328CAB4829n;
    this.table[984]  = 0x03F38C96BA582C52n; this.table[985]  = 0xCAD1BDBD7FD85DB2n; this.table[986]  = 0xBBB442C16082AE83n; this.table[987]  = 0xB95FE86BA5DA9AB0n;
    this.table[988]  = 0xB22E04673771A93Fn; this.table[989]  = 0x845358C9493152D8n; this.table[990]  = 0xBE2A488697B4541En; this.table[991]  = 0x95A2DC2DD38E6966n;
    this.table[992]  = 0xC02C11AC923C852Bn; this.table[993]  = 0x2388B1990DF2A87Bn; this.table[994]  = 0x7C8008FA1B4F37BEn; this.table[995]  = 0x1F70D0C84D54E503n;
    this.table[996]  = 0x5490ADEC7ECE57D4n; this.table[997]  = 0x002B3C27D9063A3An; this.table[998]  = 0x7EAEA3848030A2BFn; this.table[999]  = 0xC602326DED2003C0n;
    this.table[1000] = 0x83A7287D69A94086n; this.table[1001] = 0xC57A5FCB30F57A8An; this.table[1002] = 0xB56844E479EBE779n; this.table[1003] = 0xA373B40F05DCBCE9n;
    this.table[1004] = 0xD71A786E88570EE2n; this.table[1005] = 0x879CBACDBDE8F6A0n; this.table[1006] = 0x976AD1BCC164A32Fn; this.table[1007] = 0xAB21E25E9666D78Bn;
    this.table[1008] = 0x901063AAE5E5C33Cn; this.table[1009] = 0x9818B34448698D90n; this.table[1010] = 0xE36487AE3E1E8ABBn; this.table[1011] = 0xAFBDF931893BDCB4n;
    this.table[1012] = 0x6345A0DC5FBBD519n; this.table[1013] = 0x8628FE269B9465CAn; this.table[1014] = 0x1E5D01603F9C51ECn; this.table[1015] = 0x4DE44006A15049B7n;
    this.table[1016] = 0xBF6C70E5F776CBB1n; this.table[1017] = 0x411218F2EF552BEDn; this.table[1018] = 0xCB0C0708705A36A3n; this.table[1019] = 0xE74D14754F986044n;
    this.table[1020] = 0xCD56D9430EA8280En; this.table[1021] = 0xC12591D7535F5065n; this.table[1022] = 0xC83223F1720AEF96n; this.table[1023] = 0xC3A0396F7363A51Fn;
  }
}

export default hash;
