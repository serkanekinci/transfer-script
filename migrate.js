const decode = require('ent/decode');
const axios = require('axios');
const request = require('request');
const fs = require('fs');
const cheerio = require('cheerio');

//magazin   247 --->>  57 haber var
//ipuclari  251 --->>  27 haber var
//haberler  250 --->>  777 haber var
//white_label haberler 11308 ---->> 200 haber var,  url= 'https://garajsepeti.com/garajlife/wp-json/wp/v2/multiple-post-type?type[]=white_label&hurriyetoto_category=11308&per_page=1&page=${i}'

async function cmsTransfer() {
  const categoryId = 11308;      // categoryId ' ler yukarda yazıyor

  const hCategory = categoryId === 11308 ? 'hurriyetoto_category' : 'categories';

  for (let i = 4; i > 0; i--) {
    const res = await axios.get(`https://garajsepeti.com/garajlife/wp-json/wp/v2/multiple-post-type?type[]=white_label&type[]=post&${hCategory}=${categoryId}&per_page=1&page=${i}`);
    const posts = res.data[0];
    const ustPath = categoryId === 251 ? '/ipuclari/' : categoryId === 247 ? '/magazin/' : '/haberler/';
    const downloadImage = await download(posts);
    const body = await upload(downloadImage);
    const tag = await tags(posts.tags, categoryId);
    const text = await textImgIdParse(posts['content']['rendered']);
    const {data: cmsPostData} = await axios.post('http://localhost:3000/cms/api/articles', {
      "Application": "com.hurriyetoto",
      "CommentEnabled": true,
      "IsContainer": false,
      "Path": ustPath,
      "Priority": 100,
      "RedirectContent": false,
      "Status": "Draft",
      "Title": "Baslıksız"
    });
    const update = updateData();
    const startDate = new Date(posts.date).toUTCString();

    update['Ancestors'] = cmsPostData['Ancestors'];
    update['Text'] = text;
    update['Url'] = `/haber/${posts['slug']}`;
    update['ReferenceId'] = cmsPostData['AssetId'];
    update['ContentTags'] = tag;
    update['CreatedDate'] = startDate;
    update['Description'] = decode(stripHtml(posts['excerpt']['rendered']));
    update.Files[0] = body;
    update['IId'] = cmsPostData['IId'];
    update['IxName'] = posts['slug'];
    update.Links[0] = ustPath;
    update['ModifiedDate'] = cmsPostData['Path']['ModifiedDate'];
    update['ModifiedBy'] = 'sistem';
    update['Path'] = ustPath;
    update['PublishDate'] = cmsPostData['Path']['PublishDate'];
    update['SelfPath'] = `${ustPath}${posts['slug']}/`;
    update['StartDate'] = cmsPostData['Path']['StartDate'];
    update['Tags'] = tag.map(t => (t.Name));
    update['Title'] = decode(stripHtml(posts['title']['rendered']));
    update['_Id'] = cmsPostData['_Id'];
    update['id'] = cmsPostData['id'];
    console.log(update);
    axios.put(`http://localhost:3000/cms/api/articles/${cmsPostData['id']}`, update).then(function (res) {

      fs.readFile('migrate.json', 'utf8', function readFileCallback(err, data) {
        if (err) {
          console.log(err);
        } else {
          obj = JSON.parse(data);
          obj.data[posts.id] = res.data.id;
          json = JSON.stringify(obj);
          fs.writeFile('migrate.json', json, 'utf8', (err) => {
            if (err) throw err;
            console.log(`postId ${posts.id} ile cmsId  ${res.data.id} dosyaya yazıldı`);
          });
        }
      });

      console.log(i + '. haberin kaydı alındı')

    }, function (err) {
      console.log(err.response.data);
    })
  }
}

function download(data, url) {
  return new Promise(function (resolve, reject) {
    const uri = data ? data.better_featured_image.source_url : url;
    const reader = request.get(encodeURI(uri));
    const fileName = uri.replace(/https:\/\/garajlife.s3.amazonaws.com\/uploads\//gi, '').replace('/', '_').replace('/', '_')  //(01|02|03|04|05|06|07|08|09|10|11|12)\/
      .replace(/-(\d+)x(\d+)/gi, '');
    const file = reader.pipe(fs.createWriteStream(`./images/${fileName}`));
    reader.on('end', () => {
      resolve(file.path);
    })
  })
}

function upload(path) {
  return new Promise(function (resolve, reject) {
    request.post({
      url: 'http://localhost:3000/cms/api/files?$json=true',
      formData: {
        custom_file: {
          value: fs.createReadStream(path),
          options: {
            filename: path.replace('./images/', ''),
            contentType: 'image/jpeg'
          }
        }
      }
    }, function optionalCallback(err, httpResponse, body) {
      if (err) {
        return console.error('upload failed !!!! ', err);
      }
      const res = JSON.parse(body);
      return resolve(res[0])
    })
  })
}

async function tags(res, categoryId) {
  const a = res.join(',');
  const {data} = a ? await axios.get(`https://garajsepeti.com/garajlife/wp-json/wp/v2/tags?include=${a}`) : [];
  const tags = data ? data.map(t => ({IxName: t.slug, Name: t.name})) : [];
  const name = categoryId === 251 ? 'İpuçlari' : categoryId === 247 ? 'Magazin' : 'Haberler';
  const IxName = categoryId === 251 ? 'ipuclari' : categoryId === 247 ? 'magazin' : 'haberler';
  if (tags.length >= 3) return tags;
  else {
    const tag = tags.length <= 1 ? [{IxName: 'manset', Name: 'Manşet'}] : tags;
    return [...tag, {IxName: IxName, Name: name}, {IxName: 'hurriyetoto', Name: 'Hürriyet Oto'}]
  }
}

async function textImgIdParse(text) {
  const $ = cheerio.load(text);
  const imgText = $('img');
  const imgIdList = [];
  for (let i in imgText) {
    const downloadImages = imgText[i].attribs && imgText[i].attribs.src ? await download(undefined, imgText[i].attribs['src']) : undefined;
    const uploadImages = downloadImages ? await upload(downloadImages) : undefined;
    uploadImages ? imgIdList.push(uploadImages.id) : null;
  }
  return await textParse($, imgIdList);
}

async function textParse($, imgIdList) {
  $('img').each(function (i) {
    $(this).replaceWith($('<img/>').attr('src', (`/images/100/${$(this).attr('width') ? $(this).attr('width') : undefined}x${$(this).attr('height') ? $(this).attr('height') : undefined}/${imgIdList[i]}`)).attr('width', '100%'))
  });
  return $('body').html();
}

function updateData() {
  return {
    "Ancestors": [],
    "Annotations": [],
    "AnswerCount": 0,
    "Application": "com.hurriyetoto",
    // "AssetId": 0,
    "ApplicationViews": [],
    "Awards": [],
    "Cast": [],
    "Channel": "",
    "Characters": [],
    "Cities": [],
    "CommentEnabled": true,
    "ContentTags": [],
    "ContentType": "Article",
    "CreatedBy": "erhan.abay",
    "CreatedDate": "",
    "Description": "",
    "Directors": [],
    "Dubbings": [],
    "Duration": 0,
    "Editor": "",
    "EndDate": null,
    "EventSchedules": [],
    "Files": [],
    "FormPages": [],
    "FormResults": [],
    "Genres": [],
    "Guests": [],
    "HiddenId": 0,
    "Hit": 0,
    "IId": 0,
    "ImdbRating": 0,
    "InSales": false,
    "IsContainer": false,
    "IxName": "",
    "Links": [],
    "Lyrics": [],
    "MadeYear": 0,
    "MediaFiles": [],
    "MediaTags": [],
    "Moods": [],
    "Musics": [],
    "Order": 0,
    "Packages": [],
    "Pages": [],
    "Path": "",
    "PathString": "", //ekle
    "Permissions": [
      {Name: "Application:com.hurriyetoto", Privilege: {Read: true, Write: true}},
      {Name: "Group:ActiveCategories", Privilege: {Read: true, Write: true}},
      {Name: "Group:CMSUser", Privilege: {Read: true, Write: true}},
      {Name: "Group:SuperAdmin", Privilege: {Read: true, Write: true}}],
    "PersonTypes": [],
    "Price": [],
    "Producers": [],
    "Properties": [],
    "PublishStatus": {
      "Publish": true,
      "Unpublish": false,
      "Published": false,
      "Pending": false
    },
    "Quantity": 0,
    "Rating": 0,
    "RedirectContent": false,
    "RedirectStatusCode": 0,
    "ReferenceId": 0,
    "Relations": [],
    "ReplaceAllChildEndDate": true,
    "ReplaceAllChildPermissions": false,
    "Similars": [],
    "Singers": [],
    "SocialTags": null,
    "Speakers": [],
    "SpriteImages": [],
    "StartDate": "",
    "Status": "Active",
    "SubTitles": [],
    "Tags": [],
    "Template": null,
    "Text": "",
    "TextTags": [],
    "Title": "",
    "Topics": [],
    "Type": [],
    "Url": "",
    "UserNibbles": [],
    "Users": [],
    "ViewCount": 0,
    "WorkflowStatus": {
      "NotificationSent": false
    },
    "Writers": [],
    "_Id": "",
    "id": ""
  }
}

function stripHtml(html) {
  return html
    .replace(/<(?:.|\n)*?>/gm, '')
    .replace(/\[.*\]/, '...')
    .replace(new RegExp('&#8217;', 'g'), "'");
}

cmsTransfer();


//const ayniHaberler = [6663, 6669, 6691, 6822, 6874, 6923, 6931, 6979, 6985, 7008, 8149,8433, 8437,8462]
